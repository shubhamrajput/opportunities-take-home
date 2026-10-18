import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { BulkMoveService } from './bulk-move.service.js';

const workspaceId = '11000000-0000-4000-8000-000000000001';
const targetStageId = '31000000-0000-4000-8000-000000000001';
const bulkMoveJobId = '41000000-0000-4000-8000-000000000001';
const idempotencyKey = '51000000-0000-4000-8000-000000000001';

function knownUniqueError() {
  return new Prisma.PrismaClientKnownRequestError('Duplicate idempotency key', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function setup(options: { raceOnCreate?: boolean } = {}) {
  let storedJob: Record<string, unknown> | null = null;
  let initialLookups = 0;
  let releaseLookups!: () => void;
  const bothInitialLookups = new Promise<void>((resolve) => {
    releaseLookups = resolve;
  });
  const queuedJobs = new Map<string, unknown>();

  const prisma = {
    stage: {
      findFirst: vi.fn().mockResolvedValue({
        id: targetStageId,
        pipelineId: '21000000-0000-4000-8000-000000000001',
      }),
      count: vi.fn(),
    },
    bulkMoveJob: {
      findUnique: vi.fn(async () => {
        if (storedJob) return storedJob;
        if (options.raceOnCreate) {
          initialLookups += 1;
          if (initialLookups === 2) releaseLookups();
          await bothInitialLookups;
          return null;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (storedJob) throw knownUniqueError();
        storedJob = {
          ...data,
          id: bulkMoveJobId,
          status: 'queued',
          createdAt: new Date('2026-10-18T00:00:00.000Z'),
        };
        return storedJob;
      }),
    },
  };
  const plannerQueue = {
    add: vi.fn(
      async (_name: string, data: unknown, opts: { jobId: string }) => {
        queuedJobs.set(opts.jobId, data);
        return { id: opts.jobId };
      },
    ),
  };

  return {
    service: new BulkMoveService(prisma as never, plannerQueue as never),
    prisma,
    plannerQueue,
    queuedJobs,
    get storedJob() {
      return storedJob;
    },
  };
}

const request = (minValue = '10') => ({
  targetStageId,
  filters: { minValue },
});

describe('BulkMoveService idempotency', () => {
  it('replays a concurrent request with the same key instead of creating another logical job', async () => {
    const { service, prisma, plannerQueue, queuedJobs } = setup({
      raceOnCreate: true,
    });

    const [first, second] = await Promise.all([
      service.submit(workspaceId, idempotencyKey, request() as never),
      service.submit(workspaceId, idempotencyKey, request() as never),
    ]);

    expect(first.jobId).toBe(bulkMoveJobId);
    expect(second.jobId).toBe(bulkMoveJobId);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(prisma.bulkMoveJob.create).toHaveBeenCalledTimes(2);
    expect(plannerQueue.add).toHaveBeenCalledTimes(2);
    expect(
      new Set(
        plannerQueue.add.mock.calls.map(([, , options]) => options.jobId),
      ),
    ).toEqual(new Set([bulkMoveJobId]));
    expect(queuedJobs.size).toBe(1);
  });

  it('rejects reuse of a key when the request payload differs', async () => {
    const { service, plannerQueue } = setup();

    await service.submit(workspaceId, idempotencyKey, request('10') as never);

    await expect(
      service.submit(workspaceId, idempotencyKey, request('20') as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(plannerQueue.add).toHaveBeenCalledTimes(1);
  });
});
