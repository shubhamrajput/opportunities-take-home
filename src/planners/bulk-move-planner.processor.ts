import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { BulkMoveJobStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  buildOpportunityWhere,
  parseBulkMoveFilters,
} from '../opportunities/bulk-move-filter.js';
import {
  BULK_MOVE_CHUNK_REQUESTED,
  BULK_MOVE_PLANNER_QUEUE,
  BULK_MOVE_PLAN_REQUESTED,
  BULK_MOVE_QUEUE,
} from '../queue/queue.constants.js';

const CHUNK_SIZE = 250;
const MAX_OPPORTUNITIES_PER_BULK_MOVE = 50_000;

type PlannerJobData = { bulkMoveJobId: string };
type ChunkOpportunity = { opportunityId: string; version: number };
type ChunkJobData = {
  bulkMoveJobId: string;
  chunkNumber: number;
  opportunities: ChunkOpportunity[];
};
type PendingChunk = {
  cursor: string;
  chunkNumber: number;
  opportunities: ChunkOpportunity[];
};
type PlannerProgress = {
  cursor: string | null;
  nextChunkNumber: number;
  plannedCount: number;
  pendingChunk?: PendingChunk;
};

@Processor(BULK_MOVE_PLANNER_QUEUE)
export class BulkMovePlannerProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkMovePlannerProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULK_MOVE_QUEUE) private readonly bulkMoveQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<PlannerJobData>): Promise<void> {
    if (job.name !== BULK_MOVE_PLAN_REQUESTED) {
      throw new Error(`Unsupported bulk-move planner job: ${job.name}`);
    }

    const bulkMoveJobId = job.data?.bulkMoveJobId;
    if (!bulkMoveJobId) {
      throw new Error('Bulk-move planner job is missing bulkMoveJobId');
    }

    const bulkMoveJob = await this.prisma.bulkMoveJob.findUnique({
      where: { id: bulkMoveJobId },
      select: {
        id: true,
        workspaceId: true,
        pipelineId: true,
        targetStageId: true,
        filters: true,
        status: true,
      },
    });
    if (!bulkMoveJob) throw new Error(`Bulk-move job ${bulkMoveJobId} was not found`);
    if (
      bulkMoveJob.status === BulkMoveJobStatus.completed ||
      bulkMoveJob.status === BulkMoveJobStatus.failed
    ) {
      return;
    }

    try {
      const filters = parseBulkMoveFilters(bulkMoveJob.filters);
      const where = buildOpportunityWhere(bulkMoveJob, filters);
      const progress = this.readProgress(job.progress);
      let plannedCount = progress.plannedCount;

      // Keep a repeatable-read snapshot while keyset pages are read. Application
      // memory stays bounded to one 250-row page and its queue payload.
      await this.prisma.$transaction(
        async (tx) => {
          let cursor = progress.cursor;
          let nextChunkNumber = progress.nextChunkNumber;

          if (progress.pendingChunk) {
            await this.enqueueChunk(bulkMoveJob.id, progress.pendingChunk);
            cursor = progress.pendingChunk.cursor;
            nextChunkNumber = progress.pendingChunk.chunkNumber + 1;
            plannedCount += progress.pendingChunk.opportunities.length;
            await job.updateProgress({ cursor, nextChunkNumber, plannedCount });
          }

          while (plannedCount < MAX_OPPORTUNITIES_PER_BULK_MOVE) {
            const page = await tx.opportunity.findMany({
              where: {
                AND: [
                  where,
                  ...(cursor ? [{ id: { gt: cursor } }] : []),
                ],
              },
              select: { id: true, version: true },
              orderBy: { id: 'asc' },
              take: Math.min(
                CHUNK_SIZE,
                MAX_OPPORTUNITIES_PER_BULK_MOVE - plannedCount,
              ),
            });
            if (page.length === 0) break;

            const pendingChunk: PendingChunk = {
              cursor: page[page.length - 1].id,
              chunkNumber: nextChunkNumber,
              opportunities: page.map(({ id, version }) => ({
                opportunityId: id,
                version,
              })),
            };

            // Save the payload before enqueueing it. If the planner is interrupted
            // between Redis and this checkpoint, the retry reuses the same job ID.
            await job.updateProgress({
              cursor,
              nextChunkNumber,
              plannedCount,
              pendingChunk,
            } satisfies PlannerProgress);
            await this.enqueueChunk(bulkMoveJob.id, pendingChunk);

            cursor = pendingChunk.cursor;
            nextChunkNumber += 1;
            plannedCount += page.length;
            await job.updateProgress({ cursor, nextChunkNumber, plannedCount });
          }

        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 10_000,
          timeout: 50_000,
        },
      );

      // Workers may update processed/moved counters while planning. Finalize
      // total/status after the repeatable-read snapshot closes, using the
      // default read-committed isolation to avoid a serialization conflict
      // with those concurrent counter updates.
      await this.prisma.$executeRaw`
        UPDATE "bulk_move_jobs"
        SET "total" = ${plannedCount},
            "status" = CASE
              WHEN "processed" >= ${plannedCount}
                THEN 'completed'::"bulk_move_job_status"
              ELSE 'running'::"bulk_move_job_status"
            END,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${bulkMoveJob.id}::uuid
          AND "status" IN ('queued'::"bulk_move_job_status", 'running'::"bulk_move_job_status")
      `;
    } catch (error) {
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        try {
          await this.prisma.bulkMoveJob.updateMany({
            where: {
              id: bulkMoveJob.id,
              status: { in: [BulkMoveJobStatus.queued, BulkMoveJobStatus.running] },
            },
            data: { status: BulkMoveJobStatus.failed },
          });
        } catch (markError) {
          this.logger.error(
            `Could not mark bulk-move job ${bulkMoveJob.id} failed after planner error`,
            markError,
          );
        }
      }
      throw error;
    }
  }

  private async enqueueChunk(
    bulkMoveJobId: string,
    chunk: PendingChunk,
  ): Promise<void> {
    const data: ChunkJobData = {
      bulkMoveJobId,
      chunkNumber: chunk.chunkNumber,
      opportunities: chunk.opportunities,
    };
    await this.bulkMoveQueue.add(BULK_MOVE_CHUNK_REQUESTED, data, {
      jobId: `bulk-move-${bulkMoveJobId}-${chunk.chunkNumber}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  }

  private readProgress(value: Job['progress']): PlannerProgress {
    if (!value || typeof value !== 'object') {
      return { cursor: null, nextChunkNumber: 0, plannedCount: 0 };
    }
    const source = value as Partial<PlannerProgress>;
    const pending = source.pendingChunk;
    return {
      cursor: typeof source.cursor === 'string' ? source.cursor : null,
      nextChunkNumber:
        Number.isInteger(source.nextChunkNumber) && source.nextChunkNumber! >= 0
          ? source.nextChunkNumber!
          : 0,
      plannedCount:
        Number.isInteger(source.plannedCount) && source.plannedCount! >= 0
          ? source.plannedCount!
          : 0,
      ...(pending &&
      typeof pending.cursor === 'string' &&
      Number.isInteger(pending.chunkNumber) &&
      Array.isArray(pending.opportunities)
        ? { pendingChunk: pending }
        : {}),
    };
  }
}
