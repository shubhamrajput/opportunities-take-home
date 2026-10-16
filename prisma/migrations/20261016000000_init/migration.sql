-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "opportunity_status" AS ENUM ('open', 'won', 'lost', 'abandoned');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "opportunity_status" NOT NULL DEFAULT 'open',
    "owner_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_transitions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "from_stage_id" UUID NOT NULL,
    "to_stage_id" UUID NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_workspace_id_id_key" ON "pipelines"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_workspace_id_name_key" ON "pipelines"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "stages_workspace_id_pipeline_id_position_idx" ON "stages"("workspace_id", "pipeline_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "stages_workspace_id_pipeline_id_id_key" ON "stages"("workspace_id", "pipeline_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stages_workspace_id_pipeline_id_name_key" ON "stages"("workspace_id", "pipeline_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stages_pipeline_id_position_key" ON "stages"("pipeline_id", "position");

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_pipeline_id_stage_id_id_idx" ON "opportunities"("workspace_id", "pipeline_id", "stage_id", "id");

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_status_stage_id_id_idx" ON "opportunities"("workspace_id", "status", "stage_id", "id");

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_owner_id_id_idx" ON "opportunities"("workspace_id", "owner_id", "id");

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_created_at_id_idx" ON "opportunities"("workspace_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_workspace_id_id_key" ON "opportunities"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "opportunity_transitions_workspace_id_opportunity_id_created_idx" ON "opportunity_transitions"("workspace_id", "opportunity_id", "created_at");

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_workspace_id_pipeline_id_fkey" FOREIGN KEY ("workspace_id", "pipeline_id") REFERENCES "pipelines"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_pipeline_id_fkey" FOREIGN KEY ("workspace_id", "pipeline_id") REFERENCES "pipelines"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_pipeline_id_stage_id_fkey" FOREIGN KEY ("workspace_id", "pipeline_id", "stage_id") REFERENCES "stages"("workspace_id", "pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_transitions" ADD CONSTRAINT "opportunity_transitions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_transitions" ADD CONSTRAINT "opportunity_transitions_workspace_id_pipeline_id_fkey" FOREIGN KEY ("workspace_id", "pipeline_id") REFERENCES "pipelines"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_transitions" ADD CONSTRAINT "opportunity_transitions_workspace_id_opportunity_id_fkey" FOREIGN KEY ("workspace_id", "opportunity_id") REFERENCES "opportunities"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_transitions" ADD CONSTRAINT "opportunity_transitions_workspace_id_pipeline_id_from_stag_fkey" FOREIGN KEY ("workspace_id", "pipeline_id", "from_stage_id") REFERENCES "stages"("workspace_id", "pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_transitions" ADD CONSTRAINT "opportunity_transitions_workspace_id_pipeline_id_to_stage__fkey" FOREIGN KEY ("workspace_id", "pipeline_id", "to_stage_id") REFERENCES "stages"("workspace_id", "pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
