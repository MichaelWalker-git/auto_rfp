# 03 — Rename document inline, with Pinecone chunk metadata propagation

**What to build:** Users with `document:edit` see a pencil icon next to the document name on every DocumentCard. Clicking it turns the name into an inline `<Input>`; Enter (or blur) commits, Escape cancels. Names are trimmed, required, 1–255 characters, and unique within the KB case-insensitively — a duplicate returns 409 with a message the UI surfaces inline. On commit, the rename is applied optimistically to the list; the server also propagates the new name to Pinecone chunk metadata (`documentName`) inline when the document has ≤ 1 000 chunks, so answer-generation citations show the current name from the next retrieval. Users without `document:edit` see no pencil icon.

**Blocked by:** 02 — Delete is durable, and `chunkCount` is tracked at index time (needs the persisted `chunkCount` to decide inline vs. deferred chunk propagation).

**Status:** ready-for-agent

- [ ] `UpdateDocumentDTOSchema.name` is tightened to `z.string().trim().min(1).max(255).optional()`. `packages/core` rebuilds.
- [ ] `useUpdateDocument` PATCHes `document/edit-document` (currently `document/update-document`, which doesn't exist).
- [ ] The audit action emitted by the edit handler on a name change is `DOCUMENT_RENAMED` (or `DOCUMENT_UPDATED`) — never `DOCUMENT_VIEWED`.
- [ ] The edit handler enforces uniqueness within the KB: queries the KB's docs, lower-case-compares names, skips the target's own SK, and returns 409 with `{ message: 'A document with this name already exists in this knowledge base.' }` on conflict.
- [ ] `DocumentCard` shows a pencil icon next to the name for users with `document:edit`, and no icon otherwise. Clicking it swaps the name for an `<Input>`; Enter/blur commits, Escape cancels; the input rejects empty and whitespace-only values client-side; a 409 response is surfaced inline.
- [ ] Rename applies optimistically to `useDocumentsByKb` via SWR `mutate` and rolls back on API error.
- [ ] When a rename changes the name and the document has `chunkCount ≤ 1000` (or an equivalent metadata-filter count for legacy docs), the handler updates each chunk's `documentName` metadata inline, batched via `Promise.all` in groups of ~50, before returning 200.
- [ ] Pinecone chunk-metadata update failure is logged and swallowed — the DDB write is already committed and the list is correct; citations may lag until next reindex.
- [ ] Documents with `chunkCount > 1000` return 200 immediately without doing inline chunk updates (async worker follows in ticket 04); this ticket must not block on the async path being implemented.
- [ ] Jest tests on the edit handler: happy rename; empty/whitespace/too-long rejection; duplicate-name 409; audit-action assertion; inline chunk-metadata propagation for the ≤ 1 000 path; no-op inline propagation for the > 1 000 path.
- [ ] Vitest tests on `UpdateDocumentDTOSchema`: trim, min(1), max(255), optional-when-absent.
- [ ] RTL tests on `DocumentCard`: rename happy path, empty-name client-side rejection, 409 inline surface, pencil icon visible with `document:edit` and hidden without.
