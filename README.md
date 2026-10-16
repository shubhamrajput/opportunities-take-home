# Opportunities Take-Home

NestJS backend for the Opportunities bulk stage move assignment. The initial data layer uses PostgreSQL with Prisma ORM 7 and its PostgreSQL driver adapter.

## Requirements

- Node.js 24 LTS
- npm
- Docker with Compose

## Start the database, Redis, API, and worker

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

The API listens on `http://localhost:3000` by default. Redis listens on port `6379`. The API and worker connect to the same Redis queue. For a containerized run, build and start all services with `docker compose up --build`; the API and worker run in separate containers from the same image. Set `PORT` in `.env` to change the API port. After applying migrations, seed a demo workspace and pipeline:

Bull Board is available at `http://localhost:3000/queues` for read-only inspection of the `bulk-move` queue. It will remain empty until the bulk-move submission endpoint starts enqueueing jobs.

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

Implemented: NestJS app scaffold, Prisma client setup, PostgreSQL Compose service, core schema and migrations, demo workspace seed, create/list/single-stage-move opportunity routes, and atomic transition recording.

Scaffolded: Redis, BullMQ queue registration, separate worker bootstrap, and Docker Compose API/worker services. Not implemented yet: persistent bulk-job state and processing, the outbox dispatcher, the large benchmark seeding script, benchmarks, and assignment-specific reliability tests.
