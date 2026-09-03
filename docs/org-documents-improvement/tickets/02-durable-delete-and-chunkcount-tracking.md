# 02 — Delete is durable, and `chunkCount` is tracked at index time

**What to build:** Deleting a document from a Knowledge Base runs Pinecone → S3 → DDB in that order; if any step fails, the failure rethrows and the DDB row survives, so the document reappears in the list and the user can retry. Chunk deletion no longer relies on `topK: 10000` — freshly indexed documents carry a persisted `chunkCount` that lets delete reconstruct the chunk-ID list directly, and legacy documents fall back to a paginated query loop that terminates when `matches` is empty. `chunkCount` is available on `DocumentItem` for downstream features (rename propagation, follow-up backfills) to consume.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `DocumentItemSchema` (`packages/core`) gains an optional `chunkCount: z.number().int().nonnegative().optional()`. `packages/core` rebuilds cleanly and dependents typecheck.
- [ ] Index-write path persists `chunkCount` back onto the DDB `DocumentItem` when indexing finishes successfully.
- [ ] `deleteFromPinecone` uses `chunkCount` when present to build the chunk-ID list deterministically (`${sk}#${chunkKey(i)}` for `i` in `0..chunkCount-1`) — no query round-trip, no cap.
- [ ] `deleteFromPinecone` fallback path (missing `chunkCount`, i.e. legacy items) paginates the metadata-filtered query loop until `matches` returns empty; logs a warning on any fallback.
- [ ] `deleteDocument` in `helpers/document.ts` runs in order: load DDB item → delete Pinecone chunks → delete S3 objects (both `fileKey` and `textFileKey`) → delete DDB row.
- [ ] The `try/catch` that currently swallows Pinecone-delete errors is removed; a Pinecone failure rethrows and skips S3 + DDB deletion.
- [ ] An S3 failure likewise rethrows and skips DDB deletion.
- [ ] After a successful delete, the document disappears from the KB list via existing SWR `mutate(useDocumentsByKb)`; `useDocument(docId, kbId)` is invalidated too if any deep-linked route caches it.
- [ ] Jest tests on `deleteDocument`: happy path (order asserted); Pinecone failure preserves DDB row and S3 objects; S3 failure preserves DDB row.
- [ ] Jest tests on `deleteFromPinecone`: deterministic ID construction when `chunkCount` is set; paginated fallback when it isn't (asserts the loop terminates on empty `matches`).
- [ ] Vitest test on `DocumentItemSchema.chunkCount`: accepts non-negative integers, rejects negatives and non-integers, optional when absent.
