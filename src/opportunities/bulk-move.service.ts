import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  BULK_MOVE_PLAN_REQUESTED,
  BULK_MOVE_PLANNER_QUEUE,
} from '../queue/queue.constants.js';
import { BulkMoveFiltersDto, CreateBulkMoveDto } from './dto.js';

type IdempotencyJob = {
  id: string;
  status: string;
  createdAt: Date;
  requestHash: string;
};

@Injectable()
export class BulkMoveService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULK_MOVE_PLANNER_QUEUE) private readonly plannerQueue: Queue,
  ) {}

  async getStatus(workspaceId: string, jobId: string) {
    const job = await this.prisma.bulkMoveJob.findFirst({
      where: { id: jobId, workspaceId },
      select: {
        id: true,
        status: true,
        total: true,
        processed: true,
        moved: true,
        skipped: true,
        failed: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Bulk-move job not found in this workspace');
    }

    const percentage =
      job.total === null
        ? null
        : job.total === 0
          ? job.status === 'completed'
            ? 100
            : 0
          : Math.min(100, Math.floor((job.processed / job.total) * 100));

    return {
      jobId: job.id,
      status: job.status,
      progress: {
        processed: job.processed,
        total: job.total,
        percentage,
      },
      counts: {
        moved: job.moved,
        skipped: job.skipped,
        failed: job.failed,
      },
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async submit(
    workspaceId: string,
    idempotencyKey: string,
    input: CreateBulkMoveDto,
  ) {
    const targetStage = await this.prisma.stage.findFirst({
      where: { id: input.targetStageId, workspaceId },
      select: { id: true, pipelineId: true },
    });
    if (!targetStage) {
      throw new NotFoundException('Target stage not found in this workspace');
    }

    const filters = this.normalizeFilters(input.filters);
    if (filters.stageIds?.length) {
      const validStages = await this.prisma.stage.count({
        where: {
          id: { in: filters.stageIds },
          workspaceId,
          pipelineId: targetStage.pipelineId,
        },
      });
      if (validStages !== filters.stageIds.length) {
        throw new NotFoundException(
          'One or more source stages were not found in this workspace pipeline',
        );
      }
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ targetStageId: targetStage.id, filters }))
      .digest('hex');

    const existing = await this.findByIdempotencyKey(workspaceId, idempotencyKey);
    if (existing) {
      return this.replayOrConflict(existing, requestHash);
    }

    try {
      const job = await this.prisma.bulkMoveJob.create({
        data: {
          workspaceId,
          pipelineId: targetStage.pipelineId,
          targetStageId: targetStage.id,
          idempotencyKey,
          requestHash,
          filters: filters as Prisma.InputJsonObject,
        },
      });

      await this.enqueueInitialBatch(job.id);
      return this.toResponse(job, false);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const racedRequest = await this.findByIdempotencyKey(
          workspaceId,
          idempotencyKey,
        );
        if (racedRequest) {
          return this.replayOrConflict(racedRequest, requestHash);
        }
      }
      throw error;
    }
  }

  private async findByIdempotencyKey(workspaceId: string, idempotencyKey: string) {
    return this.prisma.bulkMoveJob.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
    });
  }

  private async replayOrConflict(
    job: IdempotencyJob,
    requestHash: string,
  ) {
    if (job.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different bulk move request',
      );
    }
    if (job.status === 'queued') {
      await this.enqueueInitialBatch(job.id);
    }
    return this.toResponse(job, true);
  }

  private async enqueueInitialBatch(bulkMoveJobId: string): Promise<void> {
    await this.plannerQueue.add(
      BULK_MOVE_PLAN_REQUESTED,
      { bulkMoveJobId },
      {
        jobId: bulkMoveJobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
      },
    );
  }

  private toResponse(
    job: {
      id: string;
      status: string;
      createdAt: Date;
    },
    replayed: boolean,
  ) {
    return {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      replayed,
    };
  }

  private normalizeFilters(input: BulkMoveFiltersDto) {
    return {
      ...(input.stageIds && {
        stageIds: input.stageIds.map((id) => id.toLowerCase()).sort(),
      }),
      ...(input.ownerId && { ownerId: input.ownerId.toLowerCase() }),
      ...(input.statuses && { statuses: [...input.statuses].sort() }),
      ...(input.minValue !== undefined && { minValue: input.minValue }),
      ...(input.maxValue !== undefined && { maxValue: input.maxValue }),
      ...(input.createdAfter && { createdAfter: input.createdAfter }),
      ...(input.createdBefore && { createdBefore: input.createdBefore }),
    };
  }

}
