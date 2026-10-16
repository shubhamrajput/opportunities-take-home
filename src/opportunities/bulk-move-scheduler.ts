import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { BulkMoveJobStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BULK_MOVE_QUEUE } from '../queue/queue.constants.js';

const BULK_MOVE_REQUESTED = 'bulk_move.requested';
const SCHEDULER_BATCH_SIZE = 10;

@Injectable()
export class BulkMoveScheduler {
  private readonly logger = new Logger(BulkMoveScheduler.name);
  private scheduling = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULK_MOVE_QUEUE) private readonly queue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async enqueuePendingJobs(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;

    try {
      const jobs = await this.prisma.bulkMoveJob.findMany({
        where: {
          status: { in: [BulkMoveJobStatus.queued, BulkMoveJobStatus.running] },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: SCHEDULER_BATCH_SIZE,
        select: { id: true },
      });

      for (const job of jobs) {
        try {
          await this.queue.add(
            BULK_MOVE_REQUESTED,
            { bulkMoveJobId: job.id },
            {
              jobId: job.id,
              attempts: 5,
              backoff: { type: 'exponential', delay: 1_000 },
              removeOnComplete: true,
            },
          );

          // Rotating updatedAt lets jobs beyond the first scheduler page get a turn.
          await this.prisma.bulkMoveJob.updateMany({
            where: {
              id: job.id,
              status: {
                in: [BulkMoveJobStatus.queued, BulkMoveJobStatus.running],
              },
            },
            data: { updatedAt: new Date() },
          });
        } catch (error) {
          this.logger.error(`Could not enqueue bulk-move job ${job.id}`, error);
        }
      }
    } catch (error) {
      this.logger.error('Unable to load pending bulk-move jobs', error);
    } finally {
      this.scheduling = false;
    }
  }
}
