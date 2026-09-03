# 04 — Async rename worker for documents with more than 1 000 chunks

**What to build:** When a user renames a document that has more than 1 000 chunks, the edit handler enqueues an SQS message and returns 200 immediately instead of running the chunk-metadata update loop inline. A new consumer Lambda drains the queue and iterates `index.update()` over the chunk IDs off the request path (batched with `Promise.all`), so users are never blocked on a slow update loop. The DDB row is authoritative from the moment the handler returns; citations may lag until the worker finishes.

**Blocked by:** 03 — Rename document inline, with Pinecone chunk metadata propagation (needs the rename endpoint, chunk-metadata propagation contract, and the `chunkCount`-based branching decision to already be in place for the ≤ 1 000 case).

**Status:** ready-for-agent

- [ ] New SQS queue provisioned in `packages/infra` for rename chunk-metadata updates; consumer Lambda `handlers/document/rename-chunks-worker.ts` subscribed to it; CDK route wires everything up.
- [ ] Edit handler, when the rename changes the name and `chunkCount > 1000`, enqueues a message carrying the document identity (`orgId`, `knowledgeBaseId`, `id`, `sk`, new `documentName`, `chunkCount`) and returns 200 without waiting for chunk metadata to be updated.
- [ ] Worker Lambda iterates chunk IDs deterministically from `chunkCount` and calls `index.update(id, { metadata: { documentName } })`, batched via `Promise.all` in groups of ~50.
- [ ] Worker Lambda handles partial failure via SQS's built-in retry / DLQ; individual chunk failures are logged.
- [ ] Jest tests on the edit handler: enqueue happens for `> 1 000` renames and no inline chunk-update loop runs; enqueue does not happen for `≤ 1 000` renames (regression guard for ticket 03).
- [ ] Jest tests on the worker: given a message, reconstructs chunk IDs from `chunkCount` and issues `index.update` for each; batches concurrency; surfaces failures to SQS for retry.
