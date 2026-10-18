import { Job } from 'bullmq';
import { BulkMoveJobStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BULK_MOVE_CHUNK_REQUESTED } from '../queue/queue.constants.js';
import { BulkMoveProcessor } from './bulk-move.processor.js';

type OpportunityState = {
  id: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  version: number;
};
type InMemoryState = {
  opportunity: OpportunityState;
  transitions: Record<string, unknown>[];
  job: {
    id: string;
    workspaceId: string;
    pipelineId: string;
    targetStageId: string;
    status: BulkMoveJobStatus;
    total: number | null;
    processed: number;
    moved: number;
    skipped: number;
    failed: number;
    settledChunkIds: string[];
  };
};

function setup(options: { staleSettledChunkRead?: boolean } = {}) {
  let state: InMemoryState = {
    opportunity: {
      id: '61000000-0000-4000-8000-000000000001',
      workspaceId: '11000000-0000-4000-8000-000000000001',
      pipelineId: '21000000-0000-4000-8000-000000000001',
      stageId: '31000000-0000-4000-8000-000000000001',
      version: 1,
    },
    transitions: [],
    job: {
      id: '41000000-0000-4000-8000-000000000001',
      workspaceId: '11000000-0000-4000-8000-000000000001',
      pipelineId: '21000000-0000-4000-8000-000000000001',
      targetStageId: '31000000-0000-4000-8000-000000000002',
      status: BulkMoveJobStatus.running,
      total: 2,
      processed: 0,
      moved: 0,
      skipped: 0,
      failed: 0,
      settledChunkIds: [],
    },
  };

  const prisma = {
    bulkMoveJob: {
      findUnique: vi.fn(async () => ({
        ...state.job,
        settledChunkIds: options.staleSettledChunkRead
          ? []
          : [...state.job.settledChunkIds],
      })),
    },
    $transaction: vi.fn(
      async (callback: (tx: Record<string, unknown>) => unknown) => {
        const draft = structuredClone(state);
        const tx = {
          opportunity: {
            findMany: vi.fn(
              async ({ where }: { where: Record<string, unknown> }) => {
                const alternatives = where.OR as Array<{
                  id: string;
                  version: number;
                }>;
                const stageFilter = where.stageId as { not: string };
                if (
                  draft.opportunity.workspaceId !== where.workspaceId ||
                  draft.opportunity.pipelineId !== where.pipelineId ||
                  draft.opportunity.stageId === stageFilter.not
                ) {
                  return [];
                }
                return alternatives.some(
                  ({ id, version }) =>
                    id === draft.opportunity.id &&
                    (version === undefined ||
                      version === draft.opportunity.version),
                )
                  ? [{ ...draft.opportunity }]
                  : [];
              },
            ),
            updateManyAndReturn: vi.fn(
              async ({
                where,
                data,
              }: {
                where: {
                  OR: Array<{ id: string; stageId: string; version: number }>;
                };
                data: { stageId: string; version: { increment: number } };
              }) => {
                const matches = where.OR.some(
                  ({ id, stageId, version }) =>
                    id === draft.opportunity.id &&
                    stageId === draft.opportunity.stageId &&
                    version === draft.opportunity.version,
                );
                if (!matches) return [];
                draft.opportunity.stageId = data.stageId;
                draft.opportunity.version += data.version.increment;
                return [{ id: draft.opportunity.id }];
              },
            ),
          },
          opportunityTransition: {
            createMany: vi.fn(
              async ({ data }: { data: Record<string, unknown>[] }) => {
                draft.transitions.push(...data);
                return { count: data.length };
              },
            ),
          },
          $queryRaw: vi.fn(
            async (strings: TemplateStringsArray, ...values: unknown[]) => {
              const [
                chunkId,
                processedIncrement,
                movedIncrement,
                skippedIncrement,
              ] = values;
              const sql = strings.join('?');
              const hasSettledGuard = sql.includes(
                'NOT ("settled_chunk_ids" @> jsonb_build_array(',
              );
              if (
                hasSettledGuard &&
                draft.job.settledChunkIds.includes(String(chunkId))
              ) {
                return [];
              }

              draft.job.settledChunkIds.push(String(chunkId));
              draft.job.processed += Number(processedIncrement);
              draft.job.moved += Number(movedIncrement);
              draft.job.skipped += Number(skippedIncrement);
              draft.job.status =
                draft.job.total !== null &&
                draft.job.processed >= draft.job.total
                  ? BulkMoveJobStatus.completed
                  : BulkMoveJobStatus.running;
              return [
                {
                  processed: draft.job.processed,
                  moved: draft.job.moved,
                  skipped: draft.job.skipped,
                  total: draft.job.total,
                },
              ];
            },
          ),
        };

        const result = await callback(tx);
        state = draft;
        return result;
      },
    ),
  };

  return {
    processor: new BulkMoveProcessor(prisma as unknown as PrismaService),
    prisma,
    get state() {
      return state;
    },
  };
}

function makeChunkJob(updateProgress = vi.fn().mockResolvedValue(undefined)) {
  const data = {
    bulkMoveJobId: '41000000-0000-4000-8000-000000000001',
    chunkNumber: 0,
    opportunities: [
      { opportunityId: '61000000-0000-4000-8000-000000000001', version: 1 },
    ],
  };
  return {
    job: {
      name: BULK_MOVE_CHUNK_REQUESTED,
      data,
      opts: { attempts: 5 },
      attemptsMade: 0,
      updateProgress,
    } as unknown as Job<typeof data>,
    updateProgress,
  };
}

describe('BulkMoveProcessor reliability', () => {
  it('does not double-apply a committed chunk when acknowledgement fails and BullMQ retries it', async () => {
    const context = setup();
    const updateProgress = vi
      .fn()
      .mockRejectedValueOnce(new Error('simulated acknowledgement failure'));
    const { job } = makeChunkJob(updateProgress);

    await expect(context.processor.process(job)).rejects.toThrow(
      'simulated acknowledgement failure',
    );
    await context.processor.process(job);

    expect(context.state.opportunity.stageId).toBe(
      context.state.job.targetStageId,
    );
    expect(context.state.opportunity.version).toBe(2);
    expect(context.state.transitions).toHaveLength(1);
    expect(context.state.job).toMatchObject({
      processed: 1,
      moved: 1,
      skipped: 0,
    });
    expect(context.state.job.settledChunkIds).toEqual([
      'bulk-move-41000000-0000-4000-8000-000000000001-0',
    ]);
  });

  it('uses the atomic settled-chunk guard when the initial lookup is stale', async () => {
    const context = setup({ staleSettledChunkRead: true });
    const { job } = makeChunkJob();

    await context.processor.process(job);
    await context.processor.process(job);

    expect(context.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(context.state.opportunity.stageId).toBe(
      context.state.job.targetStageId,
    );
    expect(context.state.transitions).toHaveLength(1);
    expect(context.state.job).toMatchObject({
      processed: 1,
      moved: 1,
      skipped: 0,
    });
    expect(context.state.job.settledChunkIds).toHaveLength(1);
  });

  it('skips a snapshot row whose version changed before the chunk ran', async () => {
    const context = setup();
    context.state.opportunity.stageId = '31000000-0000-4000-8000-000000000003';
    context.state.opportunity.version = 2;
    const { job } = makeChunkJob(); // Snapshot still contains version 1.

    await context.processor.process(job);

    expect(context.state.opportunity.stageId).toBe(
      '31000000-0000-4000-8000-000000000003',
    );
    expect(context.state.opportunity.version).toBe(2);
    expect(context.state.transitions).toHaveLength(0);
    expect(context.state.job).toMatchObject({
      processed: 1,
      moved: 0,
      skipped: 1,
    });
  });
});
