# Design: resumable bulk opportunity moves

## 1. Chunking Strategy, Restart Cursors, and Database Indexing

## How the job is chunked:

The API validates the request, writes a `BulkMoveJob` row to PostgreSQL, and enqueues a planning job in BullMQ. A separate planner reads matching opportunities in stable ID order using keyset pages of 250 (`id > cursor`), captures `{ opportunityId, version }`, and enqueues each page as one BullMQ chunk. It stops after 50,000 opportunities; if more match, it selects the first 50,000 by ID and leaves the rest out of this job. It keeps only one page in application memory at a time. A separate worker handles one chunk per queue task. The API, planner, and worker can scale independently. PostgreSQL remains the shared source of truth for opportunity state and job progress.

## The Index That Makes It Cheap:

The planner query is scoped by workspace and pipeline, orders by `id`, and advances with `id > cursor`. The index `opportunities(workspace_id, pipeline_id, stage_id, id)` supports the workspace/pipeline and source-stage predicates, depending on the number of selected stages. PostgreSQL may still need to sort for global ID order. Other filter fields such as status, value, owner and creation date are not all covered by this index and add filtering cost. Chunk jobs have IDs derived from the bulk-job ID and chunk number. Each worker transaction conditionally updates its rows, writes transition records and settles the chunk.

## How the cursor survives a restart:

There is no PostgreSQL cursor or chunk table today. The planner stores its keyset cursor, next chunk number, planned count, and any not-yet-confirmed chunk payload in BullMQ planner-job progress. It checkpoints a pending payload before enqueueing it and uses a deterministic chunk job ID, so a retry can safely enqueue the same page again if it crashed between the Redis enqueue and checkpoint. The chunk number identifies the task, and `BulkMoveJob.settledChunkIds` records which chunks have committed. If a worker restarts, BullMQ can redeliver active jobs and the database marker prevents double-counting. Redis is configured with AOF and a persistent volume, so queued payloads survive normal container restarts.

During one planner attempt, keyset pages are read in a PostgreSQL repeatable-read transaction, so they share one database snapshot. If the planner process restarts, that transaction snapshot is gone. The retry resumes after the persisted cursor using a new database snapshot, already-enqueued chunks keep their original IDs and versions. Redis loss also destroys queued payloads and planner progress. Exact membership across planner restarts or Redis loss requires a durable snapshot manifest (or equivalent database-backed cursor and captured rows), with additional storage and write volume.

## 2. Idempotency model

I have implement Optimistic Concurrency Control (OCC) using the version column on the opportunity table.
The API requires a UUIDv4 `Idempotency-Key`, stored on `BulkMoveJob` and unique within a workspace. The normalized target stage and filters are hashed into `requestHash`. Repeating the same key and request returns the existing job (if any), repeating the key with different input returns `409 Conflict`. This protects clients from creating duplicate bulk jobs after an uncertain HTTP response.

The key does not make the PostgreSQL insert and Redis enqueue one atomic operation. If the database write succeeds but the enqueue fails, a client retry with the same key can enqueue planning again while the job remains queued. Without a client retry, that row can remain queued. An outbox or reconciliation process would close this gap.

At the chunk level, a stable chunk ID and the `settledChunkIds` JSON array protect counters and updates from being applied twice. Opportunity changes, transition inserts, counters, and the settled marker share one transaction. If the worker crashes after commit but before BullMQ acknowledges completion, its retry sees the marker and returns. A failed transaction rolls all these effects back, so the retry can try the chunk again. Chunk jobs are currently retained by BullMQ indefinitely; a retention policy is still needed.

## 3. Concurrency on one opportunity

Both manual and bulk stage moves use optimistic concurrency. A manual move first reads the current stage and version, then updates only if the row still has those values; it increments `version` and writes the transition in the same transaction. A bulk chunk uses the version captured by the planner, reads the current stage, and conditionally updates on the current stage and version.

If a manual move commits first, its version increment makes the captured bulk version stale, so the bulk chunk skips that opportunity. If the bulk move commits first, the manual move's conditional update affects zero rows and the API returns `409 Conflict`. The two paths cannot both create a successful transition from the same observed version.

## 4. Snapshot vs Live filter set choice

This implementation chooses snapshot semantics within a planner attempt. Matching membership and versions are read from one repeatable-read snapshot and queued as immutable `{opportunityId, version}` payloads. Opportunities added later in that scan are excluded, and a captured opportunity whose version changes before its chunk runs is skipped rather than overwritten. A planner restart resumes with a new database snapshot, so the full original membership is not guaranteed across that boundary, persisted chunks remain stable, while the unread suffix may differ.

The snapshot is captured asynchronously by the planner after the API accepts the job. It is not an exact database snapshot at the HTTP request timestamp.

## 5. Isolation mechanism and remaining hole

Workspace and pipeline IDs scope every query and update. Composite keys prevent an opportunity or transition from referring to a stage in another workspace or pipeline. Version checks prevent stale writes to individual opportunities. Each 250 row chunk uses a short transaction and the worker is a separate process so bulk work does not occupy an API event loop.

API and worker still share PostgreSQL, its connection and I/O capacity and Redis. There is no per workspace database quota. During a write heavy move, API latency can rise even for other workspaces. The benchmark measures this effect -  chunk size and worker replica count are the main current pacing controls.

## 6. What breaks at 10×

With cursor-based streaming the first likely failure at 500000 records is the planner's long-running read transaction. It must read about 2000 pages and enqueue about 2000 chunks while keeping one database snapshot open. The current transaction timeout may be exceeded and the transaction also holds a connection and retains old row versions. If it fails, a retry can resume from its saved cursor but it starts a new database snapshot so it may not have the exact original membership. Node memory remains bounded to roughly one 250 row page.

With 20 million opportunities in a workspace, filter planning becomes more expensive. PostgreSQL may scan and sort many rows to find matches because the current indexes do not cover every filter combination. Once planning completes, opportunity updates and transition inserts put pressure on database write throughput.

Table Partitioning:
At 20M+ rows, split the opportunities table, partitioning partitioned by workspace_id or date ranges. This keeps the index size small.

Another isolation option is to run the planner's cursor-based selection queries against a dedicated asynchronous PostgreSQL read replica. This moves the scan and its read I/O away from the primary, leaving the primary to serve API queries and process opportunity updates but asynchronous replication can make the replica lag behind the primary.

## 7. One more week, ranked

1. **Make planning for 500,000 opportunities recover safely.** Save each selected `{opportunityId, version}` page in PostgreSQL and save where the planner should continue. This lets it retry pages already saved. A cursor by itself does not guarantee that later pages contain exactly the same opportunities after a restart, so choose and document how the job keeps one consistent set. Use repeatable IDs so a retry cannot add the same page or chunk twice.
2. **Keep planning work from slowing down the API.** The planner can read from a separate PostgreSQL replica, while workers keep writing to the primary database. First, make sure the replica has caught up far enough to include the data the job should see. Also handle replica delays or canceled queries. Limit worker concurrency and adjust it based on database load.
3. **Run the 10× benchmark and find the slowest part.** Create a workspace with 20 million opportunities and run a move of 500,000. Measure how quickly planning reads and queues pages, how quickly workers move them, how much load reaches the primary, how far behind the replica gets, and how the API responds in large and small workspaces. Write down the database and worker settings used.
4. **Check that retries keep results correct.** Test planner restarts, workers crashing after saving their work, the same chunk being delivered twice, and a person moving an opportunity while a bulk move is running. If `settledChunkIds` becomes too large or slows down database writes, move chunk completion records into their own table.
5. **Make stuck jobs visible and recoverable.** Add a way to find jobs saved in PostgreSQL but not added to the planner queue. Set rules for removing old queue jobs and saved pages. Alert when jobs stop making progress, retries run out, the replica falls behind, or API response times stay high.
