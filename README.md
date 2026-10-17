# Opportunities Take-Home

NestJS backend for the Opportunities bulk stage move assignment. The initial data layer uses PostgreSQL with Prisma ORM 7 and its PostgreSQL driver adapter.

## Requirements

- Node.js 24 LTS
- npm
- Docker with Compose

## Start the database, Redis, API, planner, and worker

```sh
cp .env.example .env
npm install
npm run db:up
npm run prisma:migrate:deploy
npm run start:dev
```

In a second terminal, start the worker:

```sh
npm run start:worker:dev
```

In a third terminal, start the planner:

```sh
npm run start:planner:dev
```

The API listens on `http://localhost:3000` by default. Redis listens on port `6379`. The API, planner, and worker connect to the same Redis instance. For a containerized run, build and start all services with `docker compose up --build`; each process runs in its own container from the same image. Set `PORT` in `.env` to change the API port. After applying migrations, seed a demo workspace and pipeline:

Bull Board is available at `http://localhost:3000/queues` for read-only inspection of the `bulk-move` and `bulk-move-planner` queues. The API enqueues a planning task. The planner snapshots matching opportunity IDs and versions in stable ID order, then enqueues chunks of 250 directly to BullMQ. The worker fetches each opportunity’s current stage, applies the version check with one conditional `updateManyAndReturn`, and creates transitions in the same transaction. A compact list of settled chunk IDs on the bulk job keeps retries from double-counting progress without a separate chunk table.

```sh
npm run seed:dev
```

### Seed and measure a large bulk move

Seed one workload workspace with 500,000 opportunities across 12 stages, plus five small comparison workspaces. By default, 50,000 opportunities are in the source stage for the bulk-move run, 100 are in the workload API-probe stage, and each comparison workspace has 1,000 opportunities:

```sh
npm run seed:benchmark
```

Use `--count`, `--move-count`, `--probe-count`, and `--small-workspace-count` to adjust the fixture while staying within the assignment's 500,000-row data set and the current 50,000-row move limit. The seed is repeatable: deterministic IDs mean existing rows are left in place. Before a new measurement, use `--reset` to recreate the fixture at the requested sizes and clear its transition history:

```sh
npm run seed:benchmark -- --count=500000 --move-count=50000 --probe-count=100 --small-workspace-count=1000 --reset
```

Reset deletes and recreates opportunities only in the dedicated benchmark workspaces, refuses to run while either has an active bulk-move job, and keeps previous job records. Start the API, planner, and worker, then measure the bulk move:

```sh
npm run benchmark:bulk-move
```

The measurement submits one 50,000-opportunity bulk move and polls its persisted status. While it runs, it repeatedly lists the probe stage in the large workspace and in all five small workspaces. The JSON report includes submission latency, total duration, moved opportunities per second, and p50/p95/max list latency for each workspace before and during the move. If you seeded a different move size, set `BENCHMARK_MOVE_COUNT` to the same value. Configure `API_URL`, `BENCHMARK_TIMEOUT_MS`, and `BENCHMARK_PROBE_INTERVAL_MS` if needed. Run the benchmark on an otherwise idle local setup and compare multiple runs; the measurements include local machine, database, and network overhead.

### Opportunity API

All opportunity routes require an `X-Workspace-Id` header. The demo seed prints the workspace, pipeline, and stage IDs to use.

Create an opportunity:

```sh
curl -X POST http://localhost:3000/opportunities \
  -H 'Content-Type: application/json' \
  -H 'X-Workspace-Id: 10000000-0000-4000-8000-000000000001' \
  -d '{"pipelineId":"20000000-0000-4000-8000-000000000001","stageId":"30000000-0000-4000-8000-000000000001","name":"Northstar deal","value":"12500.00"}'
```

List opportunities in a stage (page and limit default to 1 and 20; limit is capped at 100):

```sh
curl 'http://localhost:3000/opportunities?stageId=30000000-0000-4000-8000-000000000001&page=1&limit=20' \
  -H 'X-Workspace-Id: 10000000-0000-4000-8000-000000000001'
```

Move an opportunity to another stage. The update and transition record are committed in one transaction. A concurrent change returns `409 Conflict`; moving to its current stage is a no-op.

```sh
curl -X PATCH http://localhost:3000/opportunities/<opportunity-id>/stage \
  -H 'Content-Type: application/json' \
  -H 'X-Workspace-Id: 10000000-0000-4000-8000-000000000001' \
  -d '{"stageId":"30000000-0000-4000-8000-000000000002"}'
```

Submit a bulk move. The API returns `202 Accepted` with a job ID. `Idempotency-Key` must be a UUIDv4; retrying the same key and request returns the same job, while reusing the key with different input returns `409 Conflict`. The job is saved in PostgreSQL and its planning task is enqueued in BullMQ by the API. The planner captures ID/version pairs for matching opportunities and splits them into chunks of 250. Processing workers move those chunks, record stage transitions, and update counters in one transaction per chunk.

Poll the job status and persisted progress using the returned `jobId`:

```sh
curl http://localhost:3000/opportunities/bulk-move/<jobId> \
  -H 'X-Workspace-Id: <workspaceId>'
```

The response includes the job status, processed/total counts, a percentage, and moved/skipped/failed counts. It reads from PostgreSQL, so it is independent of Redis queue state.

Supported filters are source `stageIds`, `ownerId`, `statuses`, inclusive `minValue`/`maxValue`, and inclusive `createdAfter`/`createdBefore` timestamps. Source stages and the target stage must belong to the same workspace pipeline.

```sh
curl -X POST http://localhost:3000/opportunities/bulk-move \
  -H 'Content-Type: application/json' \
  -H 'X-Workspace-Id: 10000000-0000-4000-8000-000000000001' \
  -H 'Idempotency-Key: 40000000-0000-4000-8000-000000000001' \
  -d '{"targetStageId":"30000000-0000-4000-8000-000000000002","filters":{"stageIds":["30000000-0000-4000-8000-000000000001"],"statuses":["open"],"minValue":"0","createdAfter":"2025-01-01T00:00:00.000Z"}}'
```

## Database commands

```sh
npm run db:up                 # Start PostgreSQL
npm run db:down               # Stop containers, keeping the database volume
npm run prisma:generate       # Generate the Prisma client
npm run prisma:migrate:dev    # Create/apply a migration during development
npm run prisma:migrate:deploy # Apply committed migrations
```

`npm run db:up` starts PostgreSQL and Redis for local NestJS development. The API and worker can also be run as Docker Compose services; inside Compose they use the service names `postgres` and `redis` rather than `localhost`.

The Prisma schema is in `prisma/schema.prisma`. It defines workspaces, pipelines, ordered stages, opportunities, and stage transitions. Tenant IDs are part of the database relations so an opportunity or transition cannot reference a stage or pipeline from another workspace.

## Current scope

Implemented: NestJS app scaffold, Prisma client setup, PostgreSQL and Redis Compose services, core schema and migrations, demo workspace seed, opportunity routes, atomic transition recording, idempotent bulk-move submission, a planner process that snapshots and splits matching opportunity IDs and versions into BullMQ chunks, chunk workers using conditional bulk updates, persisted job status/progress, and a read-only Bull Board dashboard.

Not implemented yet: assignment-specific reliability tests.
