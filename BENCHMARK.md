# Benchmark Report

## Environment

- Host: Apple Silicon Mac (`darwin/arm64`)
- Docker Desktop: 4.95.0
- Docker Engine: 29.8.2 (`linux/arm64`)
- Node.js (API container): 24.22.0
- PostgreSQL: 17.11
- Redis: 7.4.11
- Docker resources: 10 CPUs, 8 GB memory
- Mac model and RAM: MAC AIR M5 and 16GB

## Workload and Method

Each run started from a reset benchmark dataset: a large workspace with 500,000 opportunities across 12 stages, plus five comparison workspaces with 1,000 opportunities each. Each run submitted one bulk move for 50,000 opportunities. I ran five trials, resetting the dataset before every trial.

The benchmark measured bulk-move duration and throughput. It also listed a probe stage in the large workspace and one stage in each small workspace before and during the move.

- Baseline: 5 API samples per workspace per run
- During the move: 13–23 API samples per workspace per run, depending on move duration
- API probe failures: 0 across all five runs

## Results

All five jobs completed and moved 50,000 opportunities, with 0 skipped and 0 failed. The table shows the bulk-move results and API latency during each move. “Small workspace p95” is the highest p95 across the five small workspaces for that run.

| Run | Submit ms | Duration s | Moved/sec | Large workspace p50 / p95 ms | Highest small-workspace p95 ms |
|---:|---:|---:|---:|---:|---:|
| 1 | 21.73 | 11.94 | 4,186.30 | 22.67 / 29.95 | 11.13 |
| 2 | 51.06 | 7.13 | 7,017.50 | 35.98 / 535.27 | 243.46 |
| 3 | 8.32 | 6.40 | 7,815.73 | 23.70 / 40.92 | 15.24 |
| 4 | 9.24 | 6.66 | 7,506.02 | 40.45 / 59.15 | 17.86 |
| 5 | 7.62 | 6.59 | 7,584.99 | 40.41 / 54.29 | 21.36 |

| Measure | Median across five runs | Range |
|---|---:|---:|
| Submission latency | 9.24 ms | 7.62–51.06 ms |
| Bulk-move duration | 6.66 s | 6.40–11.94 s |
| Throughput | 7,506.02 opportunities/s | 4,186.30–7,815.73 opportunities/s |
| Large workspace p95 during move | 54.29 ms | 29.95–535.27 ms |
| Highest small-workspace p95 during move | 17.86 ms | 11.13–243.46 ms |

## Observations

All five moves completed with the expected counts, and no API probes failed. The median move took 6.66 seconds at about 7,506 opportunities per second. API latency varied between runs. Run 2 had a much higher p95 than the other runs in both the large workspace and a small workspace, so the median is a better summary than choosing the fastest run, the outlier should still be investigated.

## Limitations

These five runs used a local Docker Compose setup. Each baseline p95 uses only five samples, and the during-move sample count was 13–23, so one slow request can strongly affect p95. The benchmark seeded 500,000 opportunities but moved 50,000. It reports API latency and job throughput, but does not measure CPU, memory, or PostgreSQL utilization. Treat these results as a local measurement, not a latency guarantee for production hardware.
