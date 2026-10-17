import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  OpportunityStatus,
  Prisma,
  PrismaClient,
} from './generated/prisma/client.js';
import { benchmarkData } from './benchmark-data.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed benchmark data');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const args = process.argv.slice(2);
const readNumber = (name: string, fallback: number): number => {
  const value = args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
};

const opportunityCount = readNumber('count', benchmarkData.defaultOpportunityCount);
const moveCount = readNumber('move-count', benchmarkData.defaultMoveCount);
const probeCount = readNumber('probe-count', 100);
const smallWorkspaceCount = readNumber(
  'small-workspace-count',
  benchmarkData.defaultSmallWorkspaceOpportunityCount,
);
const reset = args.includes('--reset');
const BATCH_SIZE = 1_000;

if (opportunityCount > benchmarkData.defaultOpportunityCount) {
  throw new Error('--count cannot exceed the assignment fixture size of 500,000');
}
if (moveCount > benchmarkData.defaultMoveCount) {
  throw new Error('--move-count cannot exceed the current 50,000 bulk-move limit');
}
if (moveCount + probeCount > opportunityCount) {
  throw new Error('--count must include --move-count plus --probe-count opportunities');
}

function deterministicId(prefix: string, number: number): string {
  return `${prefix}${number.toString(16).padStart(12, '0')}`;
}

async function ensureWorkspace(data: {
  workspaceId: string;
  pipelineId: string;
  stages: { id: string; name: string; position: number }[];
  workspaceName: string;
  pipelineName: string;
}) {
  await prisma.workspace.upsert({
    where: { id: data.workspaceId },
    update: { name: data.workspaceName },
    create: { id: data.workspaceId, name: data.workspaceName },
  });
  await prisma.pipeline.upsert({
    where: { id: data.pipelineId },
    update: { workspaceId: data.workspaceId, name: data.pipelineName },
    create: {
      id: data.pipelineId,
      workspaceId: data.workspaceId,
      name: data.pipelineName,
    },
  });
  for (const stage of data.stages) {
    await prisma.stage.upsert({
      where: { id: stage.id },
      update: {
        workspaceId: data.workspaceId,
        pipelineId: data.pipelineId,
        name: stage.name,
        position: stage.position,
      },
      create: {
        ...stage,
        workspaceId: data.workspaceId,
        pipelineId: data.pipelineId,
      },
    });
  }
}

async function ensureNoActiveJobs(workspaceIds: string[]) {
  const active = await prisma.bulkMoveJob.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      status: { in: ['queued', 'running'] },
    },
    select: { id: true, status: true },
  });
  if (active.length) {
    throw new Error(
      `Cannot reset benchmark data while bulk-move jobs are active: ${active
        .map(({ id, status }) => `${id} (${status})`)
        .join(', ')}`,
    );
  }
}

async function resetBenchmarkRows(workspaceIds: string[]) {
  await ensureNoActiveJobs(workspaceIds);
  await prisma.opportunityTransition.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await prisma.opportunity.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
}

async function insertBatches(records: Prisma.OpportunityCreateManyInput[]) {
  for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
    await prisma.opportunity.createMany({
      data: records.slice(offset, offset + BATCH_SIZE),
      skipDuplicates: true,
    });
  }
}

async function seedWorkloadWorkspace() {
  const workload = benchmarkData.workload;
  await ensureWorkspace({
    workspaceId: workload.workspaceId,
    pipelineId: workload.pipelineId,
    workspaceName: 'Bulk Move Benchmark Workspace',
    pipelineName: 'Bulk Move Benchmark Pipeline',
    stages: workload.stageIds.map((id, index) => ({
      id,
      name:
        index === benchmarkData.sourceStageIndex
          ? 'Bulk Move Source'
          : index === benchmarkData.targetStageIndex
            ? 'Bulk Move Target'
            : index === benchmarkData.probeStageIndex
              ? 'API Latency Probe'
              : `Benchmark Stage ${index + 1}`,
      position: index + 1,
    })),
  });

  for (let offset = 0; offset < opportunityCount; offset += BATCH_SIZE) {
    const end = Math.min(offset + BATCH_SIZE, opportunityCount);
    const records: Prisma.OpportunityCreateManyInput[] = [];
    for (let zeroBasedIndex = offset; zeroBasedIndex < end; zeroBasedIndex += 1) {
      let stageIndex: number;
      if (zeroBasedIndex < moveCount) {
        stageIndex = benchmarkData.sourceStageIndex;
      } else if (zeroBasedIndex >= opportunityCount - probeCount) {
        stageIndex = benchmarkData.probeStageIndex;
      } else {
        const regularStageCount = workload.stageIds.length - 2;
        stageIndex =
          1 + ((zeroBasedIndex - moveCount) % regularStageCount);
      }

      const index = zeroBasedIndex + 1;
      records.push({
        id: deterministicId('41000000-0000-4000-8000-', index),
        workspaceId: workload.workspaceId,
        pipelineId: workload.pipelineId,
        stageId: workload.stageIds[stageIndex],
        name:
          stageIndex === benchmarkData.probeStageIndex
            ? `Workload API probe ${String(index).padStart(6, '0')}`
            : `Benchmark opportunity ${String(index).padStart(6, '0')}`,
        value: `${(index % 100_000) + 1}.00`,
        status: OpportunityStatus.open,
        version: 0,
      });
    }
    await insertBatches(records);
  }
}

async function seedSmallWorkspaces() {
  for (let workspaceIndex = 0; workspaceIndex < benchmarkData.smallWorkspaces.length; workspaceIndex += 1) {
    const small = benchmarkData.smallWorkspaces[workspaceIndex];
    await ensureWorkspace({
      workspaceId: small.workspaceId,
      pipelineId: small.pipelineId,
      workspaceName: `Bulk Move Comparison Workspace ${workspaceIndex + 1}`,
      pipelineName: `Comparison Pipeline ${workspaceIndex + 1}`,
      stages: [{ id: small.stageId, name: 'API Latency Probe', position: 1 }],
    });

    const records: Prisma.OpportunityCreateManyInput[] = Array.from(
      { length: smallWorkspaceCount },
      (_, offset) => {
        const index = offset + 1;
        return {
          id: deterministicId(
            `${(51 + workspaceIndex).toString()}000000-0000-4000-8000-`,
            index,
          ),
          workspaceId: small.workspaceId,
          pipelineId: small.pipelineId,
          stageId: small.stageId,
          name: `Comparison API probe ${String(index).padStart(5, '0')}`,
          value: `${index * 10}.00`,
          status: OpportunityStatus.open,
          version: 0,
        };
      },
    );
    await insertBatches(records);
  }
}

try {
  const workspaceIds = [
    benchmarkData.workload.workspaceId,
    ...benchmarkData.smallWorkspaces.map(({ workspaceId }) => workspaceId),
  ];

  if (reset) await resetBenchmarkRows(workspaceIds);
  await seedWorkloadWorkspace();
  await seedSmallWorkspaces();

  console.log(`Workload opportunities: ${opportunityCount}`);
  console.log(`Workload stages: ${benchmarkData.workload.stageIds.length}`);
  console.log(`Source stage opportunities to move: ${moveCount}`);
  console.log(`Main workspace API probe opportunities: ${probeCount}`);
  console.log(`Comparison workspaces: ${benchmarkData.smallWorkspaces.length}`);
  console.log(`Opportunities per comparison workspace: ${smallWorkspaceCount}`);
  console.log(`Main workspace ID: ${benchmarkData.workload.workspaceId}`);
  console.log(`Source stage ID: ${benchmarkData.workload.stageIds[benchmarkData.sourceStageIndex]}`);
  console.log(`Target stage ID: ${benchmarkData.workload.stageIds[benchmarkData.targetStageIndex]}`);
  console.log(`Probe stage ID: ${benchmarkData.workload.stageIds[benchmarkData.probeStageIndex]}`);
  console.log(
    reset
      ? 'The six dedicated benchmark workspaces were reset; previous bulk-move job records were kept.'
      : 'Existing deterministic benchmark rows were left unchanged; use --reset before a fresh measurement.',
  );
} finally {
  await prisma.$disconnect();
}
