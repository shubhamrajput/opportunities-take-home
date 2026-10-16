import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { BulkMoveJobStatus } from '../generated/prisma/client.js';
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

type PlannerJobData = { bulkMoveJobId: string };
type ChunkOpportunity = { opportunityId: string; version: number };
type ChunkJobData = {
  bulkMoveJobId: string;
  chunkNumber: number;
  opportunities: ChunkOpportunity[];
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
      // This query defines the job's fixed membership and captures each row's
      // version at submission time. Later worker retries use these same values.
      const snapshot = await this.prisma.opportunity.findMany({
        where,
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
        take: 50_000,
      });

      await this.prisma.bulkMoveJob.updateMany({
        where: {
          id: bulkMoveJob.id,
          status: { in: [BulkMoveJobStatus.queued, BulkMoveJobStatus.running] },
        },
        data: {
          status:
            snapshot.length === 0
              ? BulkMoveJobStatus.completed
              : BulkMoveJobStatus.running,
          total: snapshot.length,
        },
      });

      if (snapshot.length === 0) return;

      const chunks: ChunkJobData[] = [];
      for (let offset = 0; offset < snapshot.length; offset += CHUNK_SIZE) {
        chunks.push({
          bulkMoveJobId: bulkMoveJob.id,
          chunkNumber: chunks.length,
          opportunities: snapshot
            .slice(offset, offset + CHUNK_SIZE)
            .map(({ id, version }) => ({ opportunityId: id, version })),
        });
      }

      await this.bulkMoveQueue.addBulk(
        chunks.map((data) => ({
          name: BULK_MOVE_CHUNK_REQUESTED,
          data,
          opts: {
            jobId: `bulk-move-${bulkMoveJob.id}-${data.chunkNumber}`,
            attempts: 5,
            backoff: { type: 'exponential' as const, delay: 1_000 },
          },
        })),
      );
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
}
