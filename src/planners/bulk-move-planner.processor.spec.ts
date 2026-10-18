import { Job, Queue } from 'bullmq';
import { BulkMoveJobStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  BULK_MOVE_PLAN_REQUESTED,
  BULK_MOVE_PLANNER_QUEUE,
} from '../queue/queue.constants.js';
import { BulkMovePlannerProcessor } from './bulk-move-planner.processor.js';

describe('BulkMovePlannerProcessor resume', () => {
  it('re-enqueues a checkpointed pending chunk after a crash without losing its snapshot payload', async () => {
    const originalOpportunity = {
      id: '61000000-0000-4000-8000-000000000001',
      version: 7,
    };
    let availableRows = [{ ...originalOpportunity }];
    let progress: Record<string, unknown> | number = 0;
    let failAfterEnqueue = true;
    let enqueueCalls = 0;
    let finalizedTotal: number | undefined;
    const logicalChunks = new Map<string, unknown>();

    const prisma = {
      bulkMoveJob: {
        findUnique: vi.fn().mockResolvedValue({
          id: '41000000-0000-4000-8000-000000000001',
          workspaceId: '11000000-0000-4000-8000-000000000001',
          pipelineId: '21000000-0000-4000-8000-000000000001',
          targetStageId: '31000000-0000-4000-8000-000000000002',
          filters: {},
          status: BulkMoveJobStatus.queued,
        }),
      },
      $transaction: vi.fn(
        async (callback: (tx: Record<string, unknown>) => unknown) =>
          callback({
            opportunity: {
              findMany: vi.fn(
                async ({ where }: { where: { AND: unknown[] } }) => {
                  const cursorPredicate = where.AND.find(
                    (clause): clause is { id: { gt: string } } =>
                      Boolean(
                        clause && typeof clause === 'object' && 'id' in clause,
                      ),
                  );
                  const cursor = cursorPredicate?.id.gt;
                  return availableRows
                    .filter((row) => !cursor || row.id > cursor)
                    .slice(0, 250);
                },
              ),
            },
          }),
      ),
      $executeRaw: vi.fn(
        async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          finalizedTotal = Number(values[0]);
          return 1;
        },
      ),
    };
    const bulkMoveQueue = {
      add: vi.fn(
        async (_name: string, data: unknown, opts: { jobId: string }) => {
          enqueueCalls += 1;
          if (!logicalChunks.has(opts.jobId))
            logicalChunks.set(opts.jobId, data);
          return { id: opts.jobId };
        },
      ),
    };
    const processor = new BulkMovePlannerProcessor(
      prisma as unknown as PrismaService,
      bulkMoveQueue as unknown as Queue,
    );
    const plannerJob = {
      name: BULK_MOVE_PLAN_REQUESTED,
      data: { bulkMoveJobId: '41000000-0000-4000-8000-000000000001' },
      progress,
      opts: { attempts: 5 },
      attemptsMade: 0,
      updateProgress: vi.fn(async (next: Record<string, unknown>) => {
        const isPendingCheckpoint = 'pendingChunk' in next;
        if (!isPendingCheckpoint && enqueueCalls > 0 && failAfterEnqueue) {
          failAfterEnqueue = false;
          throw new Error('simulated planner crash after enqueue');
        }
        progress = next;
        plannerJob.progress = next;
      }),
    } as unknown as Job<{ bulkMoveJobId: string }> & {
      progress: Record<string, unknown> | number;
    };

    await expect(processor.process(plannerJob)).rejects.toThrow(
      'simulated planner crash after enqueue',
    );

    // The new planner attempt has a new database snapshot with no matching rows.
    // It must still enqueue the pending payload saved in BullMQ progress.
    availableRows = [];
    await processor.process(plannerJob);

    expect(bulkMoveQueue.add).toHaveBeenCalledTimes(2);
    expect(
      bulkMoveQueue.add.mock.calls.map(([, , options]) => options.jobId),
    ).toEqual([
      'bulk-move-41000000-0000-4000-8000-000000000001-0',
      'bulk-move-41000000-0000-4000-8000-000000000001-0',
    ]);
    expect(logicalChunks.size).toBe(1);
    expect(logicalChunks.values().next().value).toMatchObject({
      chunkNumber: 0,
      opportunities: [
        {
          opportunityId: originalOpportunity.id,
          version: originalOpportunity.version,
        },
      ],
    });
    expect(finalizedTotal).toBe(1);
  });
});
