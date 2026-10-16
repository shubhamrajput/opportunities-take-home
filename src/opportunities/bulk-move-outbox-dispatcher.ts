import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { BULK_MOVE_QUEUE } from '../queue/queue.constants.js';

const BULK_MOVE_REQUESTED = 'bulk_move.requested';
const DISPATCH_INTERVAL_MS = 1_000;
const MAX_DISPATCH_BATCH = 25;

@Injectable()
export class BulkMoveOutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BulkMoveOutboxDispatcher.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULK_MOVE_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    void this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async dispatchPending() {
    if (this.dispatching) return;
    this.dispatching = true;

    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          eventType: BULK_MOVE_REQUESTED,
          publishedAt: null,
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_DISPATCH_BATCH,
      });

      for (const event of events) {
        await this.dispatchEvent(event.id, event.bulkMoveJobId, event.attempts);
      }
    } catch (error) {
      this.logger.error('Unable to load pending bulk move outbox events', error);
    } finally {
      this.dispatching = false;
    }
  }

  private async dispatchEvent(
    eventId: string,
    bulkMoveJobId: string,
    previousAttempts: number,
  ) {
    try {
      await this.queue.add(
        BULK_MOVE_REQUESTED,
        { bulkMoveJobId },
        {
          jobId: bulkMoveJobId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
        },
      );

      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: {
          attempts: { increment: 1 },
          publishedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const attempts = previousAttempts + 1;
      const retryDelay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6));
      const message = error instanceof Error ? error.message : String(error);

      try {
        await this.prisma.outboxEvent.update({
          where: { id: eventId },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + retryDelay),
            lastError: message.slice(0, 2_000),
          },
        });
      } catch (updateError) {
        this.logger.error(
          `Failed to record outbox retry for event ${eventId}`,
          updateError,
        );
      }

      this.logger.error(`Failed to enqueue bulk move job ${bulkMoveJobId}`, error);
    }
  }
}
