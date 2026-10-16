# Opportunities Take-Home

NestJS backend for the Opportunities bulk stage move assignment. The initial data layer uses PostgreSQL with Prisma ORM 7 and its PostgreSQL driver adapter.

## Requirements

- Node.js 24 LTS
- npm
- Docker with Compose

## Start the database and API

```sh
cp .env.example .env
npm install
npm run db:up
npm run prisma:migrate:deploy
npm run start:dev
```

The API listens on `http://localhost:3000` by default. Set `PORT` in `.env` to change the port. After applying migrations, seed a demo workspace and pipeline:

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

The Prisma schema is in `prisma/schema.prisma`. It defines workspaces, pipelines, ordered stages, opportunities, and stage transitions. Tenant IDs are part of the database relations so an opportunity or transition cannot reference a stage or pipeline from another workspace.

## Current scope

Implemented: NestJS app scaffold, Prisma client setup, PostgreSQL Compose service, core schema and migrations, demo workspace seed, create/list/single-stage-move opportunity routes, and atomic transition recording.

Not implemented yet: the BullMQ/Redis worker, persistent bulk-job state and processing, the large benchmark seeding script, Docker images for the API and worker, benchmarks, and assignment-specific reliability tests.
