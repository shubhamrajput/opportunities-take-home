import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  BulkMoveJobStatus,
  OpportunityStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BULK_MOVE_QUEUE } from '../queue/queue.constants.js';

const BULK_MOVE_REQUESTED = 'bulk_move.requested';
const OPPORTUNITY_BATCH_SIZE = 100;

type BulkMoveJobData = { bulkMoveJobId: string };
type StoredFilters = {
  stageIds?: string[];
  ownerId?: string;
  statuses?: OpportunityStatus[];
  minValue?: string;
  maxValue?: string;
  createdAfter?: string;
  createdBefore?: string;
};

@Processor(BULK_MOVE_QUEUE)
export class BulkMoveProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkMoveProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<BulkMoveJobData>): Promise<void> {
    if (job.name !== BULK_MOVE_REQUESTED) {
      throw new Error(`Unsupported bulk-move queue job: ${job.name}`);
    }

    const bulkMoveJobId = job.data?.bulkMoveJobId;
    if (!bulkMoveJobId) {
      throw new Error('Bulk-move queue job is missing bulkMoveJobId');
    }

    const bulkMoveJob = await this.prisma.bulkMoveJob.findUnique({
      where: { id: bulkMoveJobId },
    });
    if (!bulkMoveJob) {
      throw new Error(`Bulk-move job ${bulkMoveJobId} was not found`);
    }
    if (bulkMoveJob.status === BulkMoveJobStatus.completed) return;
    if (bulkMoveJob.status === BulkMoveJobStatus.failed) {
      throw new UnrecoverableError(
        `Bulk-move job ${bulkMoveJobId} is already marked failed`,
      );
    }

    const filters = this.parseFilters(bulkMoveJob.filters);
    const where = this.buildOpportunityWhere(bulkMoveJob, filters);

    try {
      const total =
        bulkMoveJob.total ?? (await this.prisma.opportunity.count({ where }));
      const opportunities = await this.prisma.opportunity.findMany({
        where,
        select: { id: true, stageId: true, version: true },
        orderBy: { id: 'asc' },
        take: OPPORTUNITY_BATCH_SIZE,
      });

      if (opportunities.length === 0) {
        await this.prisma.bulkMoveJob.update({
          where: { id: bulkMoveJob.id },
          data: { status: BulkMoveJobStatus.completed, total },
        });
        await job.updateProgress({
          processed: bulkMoveJob.processed,
          total,
          moved: bulkMoveJob.moved,
          skipped: bulkMoveJob.skipped,
        });
        return;
      }

      const updatedJob = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.opportunity.updateManyAndReturn({
          where: {
            workspaceId: bulkMoveJob.workspaceId,
            pipelineId: bulkMoveJob.pipelineId,
            OR: opportunities.map(({ id, stageId, version }) => ({
              id,
              stageId,
              version,
            })),
          },
          data: {
            stageId: bulkMoveJob.targetStageId,
            version: { increment: 1 },
          },
          select: { id: true },
        });

        const selectedById = new Map(
          opportunities.map((opportunity) => [opportunity.id, opportunity]),
        );
        const transitions: Prisma.OpportunityTransitionCreateManyInput[] =
          updated.map(({ id }) => ({
            workspaceId: bulkMoveJob.workspaceId,
            pipelineId: bulkMoveJob.pipelineId,
            opportunityId: id,
            fromStageId: selectedById.get(id)!.stageId,
            toStageId: bulkMoveJob.targetStageId,
          }));

        if (transitions.length > 0) {
          await tx.opportunityTransition.createMany({ data: transitions });
        }

        return tx.bulkMoveJob.update({
          where: { id: bulkMoveJob.id },
          data: {
            status: BulkMoveJobStatus.running,
            total,
            processed: { increment: opportunities.length },
            moved: { increment: updated.length },
            skipped: { increment: opportunities.length - updated.length },
          },
          select: { processed: true, moved: true, skipped: true, total: true },
        });
      });

      await job.updateProgress(updatedJob);
    } catch (error) {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      if (isFinalAttempt) {
        await this.markFailed(bulkMoveJob.id);
      }
      throw error;
    }
  }

  private parseFilters(value: Prisma.JsonValue): StoredFilters {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Bulk-move job contains invalid filters');
    }

    const source = value as Record<string, unknown>;
    const readString = (key: string): string | undefined => {
      const item = source[key];
      if (item === undefined) return undefined;
      if (typeof item !== 'string') {
        throw new Error(`Bulk-move filter ${key} must be a string`);
      }
      return item;
    };
    const readStringArray = (key: string): string[] | undefined => {
      const item = source[key];
      if (item === undefined) return undefined;
      if (!Array.isArray(item) || !item.every((entry) => typeof entry === 'string')) {
        throw new Error(`Bulk-move filter ${key} must be an array of strings`);
      }
      return item;
    };

    return {
      stageIds: readStringArray('stageIds'),
      ownerId: readString('ownerId'),
      statuses: readStringArray('statuses') as OpportunityStatus[] | undefined,
      minValue: readString('minValue'),
      maxValue: readString('maxValue'),
      createdAfter: readString('createdAfter'),
      createdBefore: readString('createdBefore'),
    };
  }

  private buildOpportunityWhere(
    bulkMoveJob: {
      workspaceId: string;
      pipelineId: string;
      targetStageId: string;
    },
    filters: StoredFilters,
  ): Prisma.OpportunityWhereInput {
    return {
      workspaceId: bulkMoveJob.workspaceId,
      pipelineId: bulkMoveJob.pipelineId,
      stageId: {
        not: bulkMoveJob.targetStageId,
        ...(filters.stageIds?.length ? { in: filters.stageIds } : {}),
      },
      ...(filters.ownerId && { ownerId: filters.ownerId }),
      ...(filters.statuses?.length && {
        status: { in: filters.statuses },
      }),
      ...((filters.minValue !== undefined || filters.maxValue !== undefined) && {
        value: {
          ...(filters.minValue !== undefined && {
            gte: new Prisma.Decimal(filters.minValue),
          }),
          ...(filters.maxValue !== undefined && {
            lte: new Prisma.Decimal(filters.maxValue),
          }),
        },
      }),
      ...((filters.createdAfter || filters.createdBefore) && {
        createdAt: {
          ...(filters.createdAfter && { gte: new Date(filters.createdAfter) }),
          ...(filters.createdBefore && { lte: new Date(filters.createdBefore) }),
        },
      }),
    };
  }

  private async markFailed(bulkMoveJobId: string): Promise<void> {
    try {
      await this.prisma.bulkMoveJob.updateMany({
        where: { id: bulkMoveJobId, status: { not: BulkMoveJobStatus.completed } },
        data: {
          status: BulkMoveJobStatus.failed,
        },
      });
    } catch (error) {
      this.logger.error(`Could not mark bulk-move job ${bulkMoveJobId} failed`, error);
    }
  }
}
