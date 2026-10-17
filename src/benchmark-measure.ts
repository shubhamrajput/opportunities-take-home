import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { benchmarkData } from './benchmark-data.js';

const baseUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? 1_200_000);
const probeIntervalMs = Number(process.env.BENCHMARK_PROBE_INTERVAL_MS ?? 500);
const moveCount = Number(
  process.env.BENCHMARK_MOVE_COUNT ?? benchmarkData.defaultMoveCount,
);
const baselineRounds = 5;

type JobStatus = {
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: { processed: number; total: number | null; percentage: number | null };
  counts: { moved: number; skipped: number; failed: number };
};

type Probe = { durationMs: number; ok: boolean };

async function request(
  path: string,
  workspaceId: string,
  init?: RequestInit,
): Promise<{ response: Response; durationMs: number; body: any }> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'X-Workspace-Id': workspaceId,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, durationMs: performance.now() - started, body };
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function summarize(probes: Probe[]) {
  const successful = probes.filter(({ ok }) => ok).map(({ durationMs }) => durationMs);
  return {
    samples: probes.length,
    failures: probes.length - successful.length,
    p50Ms: percentile(successful, 0.5),
    p95Ms: percentile(successful, 0.95),
    maxMs: successful.length ? Math.max(...successful) : null,
  };
}

async function probe(workspaceId: string, stageId: string): Promise<Probe> {
  try {
    const result = await request(
      `/opportunities?stageId=${stageId}&page=1&limit=20`,
      workspaceId,
    );
    return { durationMs: result.durationMs, ok: result.response.ok };
  } catch {
    return { durationMs: 0, ok: false };
  }
}

function probeAllWorkspaces(): Promise<Probe[]> {
  const workload = benchmarkData.workload;
  return Promise.all([
    probe(
      workload.workspaceId,
      workload.stageIds[benchmarkData.probeStageIndex],
    ),
    ...benchmarkData.smallWorkspaces.map((workspace) =>
      probe(workspace.workspaceId, workspace.stageId),
    ),
  ]);
}

async function main() {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('BENCHMARK_TIMEOUT_MS must be a positive number');
  }
  if (!Number.isFinite(probeIntervalMs) || probeIntervalMs <= 0) {
    throw new Error('BENCHMARK_PROBE_INTERVAL_MS must be a positive number');
  }
  if (!Number.isInteger(moveCount) || moveCount < 1 || moveCount > 50_000) {
    throw new Error('BENCHMARK_MOVE_COUNT must be an integer from 1 to 50000');
  }

  const { workload } = benchmarkData;
  const allProbes: Probe[][] = [];

  for (let round = 0; round < baselineRounds; round += 1) {
    allProbes.push(await probeAllWorkspaces());
  }

  const submit = await request('/opportunities/bulk-move', workload.workspaceId, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      targetStageId: workload.stageIds[benchmarkData.targetStageIndex],
      filters: {
        stageIds: [workload.stageIds[benchmarkData.sourceStageIndex]],
        statuses: ['open'],
      },
    }),
  });
  if (submit.response.status !== 202 || !submit.body?.jobId) {
    throw new Error(
      `Bulk-move submission failed (${submit.response.status}): ${JSON.stringify(submit.body)}`,
    );
  }

  const jobId = submit.body.jobId as string;
  const moveStarted = performance.now();
  let finalStatus: JobStatus | undefined;
  let nextProbeAt = performance.now();

  while (performance.now() - moveStarted < timeoutMs) {
    if (performance.now() >= nextProbeAt) {
      allProbes.push(await probeAllWorkspaces());
      nextProbeAt = performance.now() + probeIntervalMs;
    }

    const status = await request(
      `/opportunities/bulk-move/${jobId}`,
      workload.workspaceId,
    );
    if (!status.response.ok) {
      throw new Error(
        `Bulk-move status request failed (${status.response.status}): ${JSON.stringify(status.body)}`,
      );
    }
    finalStatus = status.body as JobStatus;
    if (finalStatus.status === 'completed' || finalStatus.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const durationSeconds = (performance.now() - moveStarted) / 1_000;
  const labels = [
    'mainWorkspace',
    ...benchmarkData.smallWorkspaces.map((_, index) => `smallWorkspace${index + 1}`),
  ];
  const latencyByWorkspace = Object.fromEntries(
    labels.map((label, index) => {
      const workspaceProbes = allProbes.map((round) => round[index]);
      return [
        label,
        {
          baseline: summarize(workspaceProbes.slice(0, baselineRounds)),
          duringBulkMove: summarize(workspaceProbes.slice(baselineRounds)),
        },
      ];
    }),
  );

  const result = {
    jobId,
    expectedMoved: moveCount,
    submitLatencyMs: Number(submit.durationMs.toFixed(2)),
    status: finalStatus?.status ?? 'timeout',
    durationSeconds: Number(durationSeconds.toFixed(2)),
    progress: finalStatus?.progress,
    counts: finalStatus?.counts,
    movedPerSecond:
      durationSeconds > 0 && finalStatus
        ? Number((finalStatus.counts.moved / durationSeconds).toFixed(2))
        : null,
    listApiLatencyMs: latencyByWorkspace,
  };
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== 'completed') {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
