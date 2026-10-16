-- CreateEnum
CREATE TYPE "bulk_move_job_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "bulk_move_jobs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "target_stage_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "filters" JSONB NOT NULL,
    "status" "bulk_move_job_status" NOT NULL DEFAULT 'queued',
    "total" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "moved" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bulk_move_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "bulk_move_job_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_move_jobs_workspace_id_created_at_id_idx" ON "bulk_move_jobs"("workspace_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "bulk_move_jobs_workspace_id_status_created_at_idx" ON "bulk_move_jobs"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_move_jobs_workspace_id_id_key" ON "bulk_move_jobs"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_move_jobs_workspace_id_idempotency_key_key" ON "bulk_move_jobs"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_next_attempt_at_created_at_idx" ON "outbox_events"("published_at", "next_attempt_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_bulk_move_job_id_event_type_key" ON "outbox_events"("bulk_move_job_id", "event_type");

-- AddForeignKey
ALTER TABLE "bulk_move_jobs" ADD CONSTRAINT "bulk_move_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_move_jobs" ADD CONSTRAINT "bulk_move_jobs_workspace_id_pipeline_id_fkey" FOREIGN KEY ("workspace_id", "pipeline_id") REFERENCES "pipelines"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_move_jobs" ADD CONSTRAINT "bulk_move_jobs_workspace_id_pipeline_id_target_stage_id_fkey" FOREIGN KEY ("workspace_id", "pipeline_id", "target_stage_id") REFERENCES "stages"("workspace_id", "pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_bulk_move_job_id_fkey" FOREIGN KEY ("bulk_move_job_id") REFERENCES "bulk_move_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
