# Opportunities Take-Home

NestJS backend for the Opportunities bulk stage move assignment. The initial data layer uses PostgreSQL with Prisma ORM 7 and its PostgreSQL driver adapter.

## Requirements

- Node.js 24 LTS
- npm
- Docker with Compose

## Start the database, Redis, API, scheduler, and worker

```sh
cp .env.example .env
npm install
npm run db:up
npm run prisma:migrate:deploy
npm run start:dev
```

In separate terminals, start the worker and scheduler:

```sh
npm run start:worker:dev
```

```sh
npm run start:scheduler:dev
```

The API listens on `http://localhost:3000` by default. Redis listens on port `6379`. The API, scheduler, and worker connect to the same Redis queue. For a containerized run, build and start all services with `docker compose up --build`; the API, scheduler, and worker run in separate containers from the same image. Run one scheduler instance unless distributed scheduler coordination is added. Set `PORT` in `.env` to change the API port. After applying migrations, seed a demo workspace and pipeline:

Bull Board is available at `http://localhost:3000/queues` for read-only inspection of the `bulk-move` queue. The scheduler checks PostgreSQL every five seconds for queued or running bulk-move jobs, then enqueues one batch task at a time. The separate worker processes up to 100 opportunities per task; the next scan can enqueue another task for a job that still has matching opportunities.

```sh
npm run seed:dev
```

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

Submit a bulk move. The API returns `202 Accepted` with a job ID. `Idempotency-Key` must be a UUIDv4; retrying the same key and request returns the same job, while reusing the key with different input returns `409 Conflict`. The job is saved in PostgreSQL. The scheduler discovers it and enqueues a batch task in BullMQ. Each worker task moves up to 100 matching opportunities, records stage transitions, and updates the job counters in a transaction.

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

`npm run db:up` starts PostgreSQL and Redis for local NestJS development. The API, scheduler, and worker can also be run as Docker Compose services; inside Compose they use the service names `postgres` and `redis` rather than `localhost`.

The Prisma schema is in `prisma/schema.prisma`. It defines workspaces, pipelines, ordered stages, opportunities, and stage transitions. Tenant IDs are part of the database relations so an opportunity or transition cannot reference a stage or pipeline from another workspace.

## Current scope

Implemented: NestJS app scaffold, Prisma client setup, PostgreSQL Compose service, core schema and migrations, demo workspace seed, create/list/single-stage-move opportunity routes, atomic transition recording, bulk-move submission, database polling scheduler, batched worker processing, and a bulk-move status/progress endpoint.

Scaffolded: Redis, BullMQ queue registration, separate scheduler and worker bootstraps, Docker Compose API/scheduler/worker services, and a read-only Bull Board dashboard. Not implemented yet: the large benchmark seeding script, benchmarks, and assignment-specific reliability tests.
