# Opportunities Take-Home

Backend starter for the Opportunities bulk stage move assignment. The project uses NestJS with TypeScript. PostgreSQL, Prisma, and BullMQ will be added as the data and background-job layers are implemented.

## Requirements

- Node.js 24 LTS
- npm

## Run locally

```sh
npm install
npm run start:dev
```

The NestJS server listens on `http://localhost:3000` by default. Set `PORT` to change the port. The starter responds to `GET /` with `Hello World!`.

## Available commands

```sh
npm run build
npm run start:dev
npm run start:prod
npm run lint
```

## Current scope

This is the initial NestJS application scaffold. The assignment's API, PostgreSQL schema, Prisma integration, BullMQ worker, Docker Compose setup, seeding, and focused reliability tests have not been implemented yet.
