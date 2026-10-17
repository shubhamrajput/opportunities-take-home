import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BulkMoveJobStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  BULK_MOVE_CHUNK_REQUESTED,
  BULK_MOVE_QUEUE,
} from '../queue/queue.constants.js';

type ChunkOpportunity = { opportunityId: string; version: number };
type ChunkJobData = {
  bulkMoveJobId: string;
  chunkNumber: number;
  opportunities: ChunkOpportunity[];
};
type ChunkResult = {
  processed: number;
  moved: number;
  skipped: number;
  total: number | null;
};

class ChunkAlreadySettledError extends Error {}

@Processor(BULK_MOVE_QUEUE)
export class BulkMoveProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkMoveProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ChunkJobData>): Promise<void> {
    if (job.name !== BULK_MOVE_CHUNK_REQUESTED) {
      throw new Error(`Unsupported bulk-move queue job: ${job.name}`);
    }

    const { bulkMoveJobId, chunkNumber, opportunities } = job.data ?? {};
    if (
      !bulkMoveJobId ||
      !Number.isInteger(chunkNumber) ||
      !Array.isArray(opportunities) ||
      opportunities.some(
        (item) =>
          !item ||
          typeof item.opportunityId !== 'string' ||
          !Number.isInteger(item.version),
      )
    ) {
      throw new Error('Bulk-move chunk job has invalid data');
    }

    const chunkId = `bulk-move-${bulkMoveJobId}-${chunkNumber}`;
    const bulkMoveJob = await this.prisma.bulkMoveJob.findUnique({
      where: { id: bulkMoveJobId },
      select: {
        id: true,
        workspaceId: true,
        pipelineId: true,
        targetStageId: true,
        status: true,
        settledChunkIds: true,
      },
    });
    if (!bulkMoveJob) throw new Error(`Bulk-move job ${bulkMoveJobId} was not found`);
    if (
      bulkMoveJob.status === BulkMoveJobStatus.completed ||
      bulkMoveJob.status === BulkMoveJobStatus.failed
    ) {
      return;
    }

    const settledChunkIds = Array.isArray(bulkMoveJob.settledChunkIds)
      ? bulkMoveJob.settledChunkIds.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    if (settledChunkIds.includes(chunkId)) return;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.opportunity.findMany({
          where: {
            workspaceId: bulkMoveJob.workspaceId,
            pipelineId: bulkMoveJob.pipelineId,
            stageId: { not: bulkMoveJob.targetStageId },
            OR: opportunities.map(({ opportunityId, version }) => ({
              id: opportunityId,
              version,
            })),
          },
          select: { id: true, stageId: true, version: true },
        });

        const updated = candidates.length
          ? await tx.opportunity.updateManyAndReturn({
              where: {
                workspaceId: bulkMoveJob.workspaceId,
                pipelineId: bulkMoveJob.pipelineId,
                stageId: { not: bulkMoveJob.targetStageId },
                OR: candidates.map(({ id, stageId, version }) => ({
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
            })
          : [];

        const candidateById = new Map(
          candidates.map((candidate) => [candidate.id, candidate]),
        );
        const transitions: Prisma.OpportunityTransitionCreateManyInput[] =
          updated.map(({ id }) => ({
            workspaceId: bulkMoveJob.workspaceId,
            pipelineId: bulkMoveJob.pipelineId,
            opportunityId: id,
            fromStageId: candidateById.get(id)!.stageId,
            toStageId: bulkMoveJob.targetStageId,
          }));
        if (transitions.length > 0) {
          await tx.opportunityTransition.createMany({ data: transitions });
        }

        const skipped = opportunities.length - updated.length;
        const settled = await tx.$queryRaw<ChunkResult[]>`
          UPDATE "bulk_move_jobs"
          SET "settled_chunk_ids" = "settled_chunk_ids" || jsonb_build_array(${chunkId}::text),
              "processed" = "processed" + ${opportunities.length},
              "moved" = "moved" + ${updated.length},
              "skipped" = "skipped" + ${skipped},
              "status" = CASE
                WHEN "total" IS NOT NULL AND "processed" + ${opportunities.length} >= "total"
                  THEN 'completed'::"bulk_move_job_status"
                ELSE 'running'::"bulk_move_job_status"
              END,
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${bulkMoveJobId}::uuid
            AND "status" IN ('queued'::"bulk_move_job_status", 'running'::"bulk_move_job_status")
            AND NOT ("settled_chunk_ids" @> jsonb_build_array(${chunkId}::text))
          RETURNING "processed", "moved", "skipped", "total"
        `;

        if (settled.length !== 1) throw new ChunkAlreadySettledError();
        return settled[0];
      });

      await job.updateProgress(result);
    } catch (error) {
      if (error instanceof ChunkAlreadySettledError) return;

      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.markChunkFailed(bulkMoveJobId, chunkId, opportunities.length);
      }
      throw error;
    }
  }

  private async markChunkFailed(
    bulkMoveJobId: string,
    chunkId: string,
    itemCount: number,
  ): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        UPDATE "bulk_move_jobs"
        SET "settled_chunk_ids" = "settled_chunk_ids" || jsonb_build_array(${chunkId}::text),
            "processed" = "processed" + ${itemCount},
            "failed" = "failed" + ${itemCount},
            "status" = 'failed'::"bulk_move_job_status",
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${bulkMoveJobId}::uuid
          AND "status" IN ('queued'::"bulk_move_job_status", 'running'::"bulk_move_job_status")
          AND NOT ("settled_chunk_ids" @> jsonb_build_array(${chunkId}::text))
        RETURNING "id"
      `;
    } catch (error) {
      this.logger.error(`Could not mark bulk-move chunk ${chunkId} failed`, error);
    }
  }
}
