ALTER TABLE "bulk_move_jobs"
ADD COLUMN "settled_chunk_ids" JSONB NOT NULL DEFAULT '[]';
