# Org Documents — Download, Rename, Delete Hardening

Scope: the **Org Documents** surface (Knowledge Base document list) at
`/organizations/[orgId]/knowledge-base/[kbId]`. Not RFP-attached documents.

Companion docs:
- `docs/org-documents-improvement/DESIGN.md` — decisions and punch list.
- `docs/org-documents-improvement/GLOSSARY.md` — feature-specific vocabulary.

---

## Problem Statement

Users managing an organization's Knowledge Base cannot cleanly manage the
documents inside it:

- **Download is effectively broken for teammates.** The Download button is
  hidden for every user who is not the original uploader, even though the
  backend permits any org member with `document:read`. Users who legitimately
  need a copy of the source file can't get one.
- **Downloaded files open in a browser tab instead of saving.** Even when
  the button is visible, clicking it opens the file inline rather than
  triggering a "Save As" — which is not what "Download" implies.
- **There is no way to rename a document.** A rename backend exists but is
  unreachable from the UI, and the hook that would call it PATCHes a route
  that doesn't exist. A misnamed upload therefore lives with its wrong name
  forever, and citations in generated answers surface that wrong name.
- **Delete is not durable.** If Pinecone chunk deletion fails, the DDB row
  is still deleted, orphaning chunks that continue to surface in retrieval.
  The chunk-lookup query is also capped at 10 000 matches, so any document
  larger than that orphans silently every time.

## Solution

Fix the three flows so that Org Documents behaves the way the labels
suggest, and harden the delete path so a partial failure does not leave
orphan state.

- **Download.** Any user with `document:read` sees a Download button.
  Clicking it saves the file to disk with the document's current name and
  correct extension — never opens inline.
- **Rename.** Any user with `document:edit` sees a pencil icon next to the
  document name on its card. Clicking it turns the name into an editable
  input; Enter commits, Escape cancels. Names are trimmed, required, 1–255
  chars, and unique within the KB (case-insensitive). The new name flows
  through to the downloaded filename on the next click, and to Pinecone
  chunk metadata so that citations show the current name.
- **Delete.** Deletion runs Pinecone → S3 → DDB. Any failure rethrows and
  the DDB row is preserved, so the document reappears in the list and the
  user can retry. Chunk-lookup no longer relies on a 10 000-match cap.

## User Stories

1. As a KB manager, I want any teammate with read access to be able to
   download a document, so that ownership of the original upload does not
   gate access to the source file.
2. As a teammate with `document:read`, I want to see a Download button on
   every document I can read, so that I don't have to ask the uploader for
   a copy.
3. As a user without `document:read`, I want the Download button hidden,
   so that the UI reflects what I can actually do.
4. As a user clicking Download, I want the file to be saved to disk with
   its current name and extension, so that I get a real download instead of
   a browser preview.
5. As a user who renamed a document, I want the next Download to produce a
   file with the new name, so that the on-disk filename tracks what I see
   in the UI.
6. As a KB manager, I want to rename a document from its card, so that I
   can correct a bad filename without re-uploading.
7. As a user renaming a document, I want a pencil icon that turns the
   name into an editable input, so that the interaction is discoverable and
   in-context.
8. As a user editing a name, I want Enter to commit and Escape to cancel,
   so that the interaction matches every other inline edit.
9. As a user editing a name, I want the input to reject empty and
   whitespace-only values, so that I can't accidentally erase the name.
10. As a user editing a name, I want to be told when the new name is
    already used by another document in the same KB, so that I can pick a
    different one instead of silently overwriting it.
11. As a user editing a name, I want the check to be case-insensitive, so
    that `Report.pdf` and `report.pdf` are treated as the same name.
12. As a user renaming a document, I want the list to update immediately,
    so that the UI feels responsive even before the server confirms.
13. As a user renaming a document, I want the change to roll back if the
    server rejects it, so that I'm never lied to about what got saved.
14. As a user without `document:edit`, I want the pencil icon hidden, so
    that I don't see controls I can't use.
15. As a user renaming a document, I want the change to propagate to the
    source citations in generated answers, so that later citations show the
    current name.
16. As an operator, I want rename to succeed for small documents inline
    and to complete asynchronously for very large ones, so that the user
    isn't blocked on a slow chunk-update loop.
17. As a KB manager, I want to delete a document, so that I can remove
    material that no longer belongs in the KB.
18. As a KB manager, I want a deletion that fails midway to leave the
    document visible in the list, so that I can retry rather than hunt for
    orphan state.
19. As an operator, I want a failed Pinecone delete to abort the deletion
    rather than proceed to DDB, so that we never orphan chunks.
20. As an operator, I want chunk deletion to work regardless of chunk
    count, so that we don't silently orphan chunks in documents with more
    than 10 000 chunks.
21. As an auditor, I want a rename to be logged as `DOCUMENT_RENAMED`
    (not `DOCUMENT_VIEWED`), so that the audit trail describes what
    actually happened.
22. As a developer, I want the schema to enforce name shape at the edge,
    so that no handler has to re-validate trim/length independently.

## Implementation Decisions

### D-1  Download button gated by RBAC only

Drop the client-side `createdBy === userSub` guard on `DocumentCard`.
Render the Download button through a permission-aware wrapper
(`PermissionButton` or matching variant) with
`requiredPermission="document:read"`. No-permission users see no button —
matches the create/delete pattern already on the card.

### D-2  Download performs a real "Save As", not open-in-tab

- Backend `downloadDocument` appends `ResponseContentDisposition` to the
  `GetObjectCommand`:
  `attachment; filename="<ascii-fallback>"; filename*=UTF-8''<rfc5987>`.
  The presigned URL therefore signs the disposition header — browsers
  honour it.
- Frontend switches from `window.open(url, '_blank')` to an
  `<a href download>` click and remove.
- `fileName` in the response uses the current DDB `document.name` — rename
  therefore flows through to the downloaded filename on the next click.

### D-3  Rename via inline edit on `DocumentCard`

- Pencil icon next to the doc name; click switches the name to an `<Input>`,
  Enter / blur commits, Escape cancels.
- Uses `useUpdateDocument`, fixed to `PATCH document/edit-document`
  (currently points at a nonexistent `document/update-document`).
- Card gated by `document:edit` — no icon if the user lacks it.
- Optimistic update via SWR `mutate` on `useDocumentsByKb`; rollback on
  API error.

### D-4  Rename validation

- **Trim + non-empty, 1–255 chars** enforced in `UpdateDocumentDTOSchema.name`:
  ```ts
  name: z.string().trim().min(1).max(255).optional()
  ```
  Same rule mirrored on the frontend input.
- **Unique within KB, case-insensitive.** Enforced server-side in the edit
  handler: query docs in the same `knowledgeBaseId`, lower-case compare,
  skip the target's own SK. Return `409` on conflict with
  `{ message: 'A document with this name already exists in this knowledge base.' }`.
  Frontend surfaces the message inline.
- **File extension is _not_ enforced.** Users may rename `report.pdf` to
  `Final report` — the downloaded file's extension is derived by the
  browser from `Content-Disposition` + `Content-Type`.
- **Audit action fixed** to `DOCUMENT_RENAMED` (or `DOCUMENT_UPDATED`) —
  today it's `DOCUMENT_VIEWED`.

### D-5  Rename propagates to Pinecone chunk metadata

Chunks store `documentName` in metadata. Without propagating, source
citations in answer-generation continue to show the old name.

- **Default path: inline** in the rename handler.
- **Safety valve: cap at 1 000 chunks.**
    - Handler determines chunk count first (from `DocumentItem.chunkCount`
      when present, else metadata-filter count).
    - `count ≤ 1 000` → run inline
      `for id in ids: index.update(id, { metadata: { documentName } })`,
      batched with `Promise.all` in groups of ~50.
    - `count > 1 000` → DDB write returns 200 immediately; chunk update is
      enqueued to an SQS-fed worker Lambda.
- DDB write always commits before the Pinecone loop starts. If the loop
  later fails, log and accept eventual inconsistency (name in list is
  correct; citations may be stale until next reindex).

### D-6  Delete uses fail-fast ordering, DDB row is the commit marker

New order in `deleteDocument`:

1. Load DDB item.
2. Delete Pinecone chunks. **Rethrow on failure** (remove the try/catch
   that currently swallows this).
3. Delete S3 objects (both keys). Rethrow on failure.
4. Delete DDB row last.

If any step fails, the DDB row survives → the doc still appears in the KB
list → the user retries. No `DELETING` status, no reconciliation job.

### D-7  Pinecone delete no longer relies on `topK: 10000`

- **Preferred path.** Track `chunkCount` on `DocumentItem` at index-write
  time. Delete reconstructs the chunk IDs directly:
  `deleteMany(range(chunkCount).map(i => \`${sk}#${chunkKey(i)}\`))`.
  No query round-trip, no cap, deterministic.
- **Fallback for legacy docs without `chunkCount`.** Current
  query-then-delete path, but paginate the metadata-filter query loop
  until `matches` returns empty. Log a warning on any legacy fallback.
- New optional field:
  `chunkCount?: z.number().int().nonnegative()` on `DocumentItemSchema`.

### D-8  Cache invalidation on delete: SWR only

- `refreshDocuments()` (SWR `mutate` on `useDocumentsByKb`) already runs
  after delete — confirm it stays.
- Also invalidate `useDocument(docId, kbId)` if any deep-linked route
  caches it.
- **Explicitly deferred:** `compliance-review-doc-cache` DDB entries,
  answer-generation retrieval caches, and Step-Function `taskToken`
  cancellation. Follow-up ticket if any of those are observed to leak
  stale data.

### D-9  Non-owner UX

- Both Download and Rename icons are hidden entirely when the user lacks
  the corresponding permission (`document:read` / `document:edit`). No
  disabled-with-tooltip variant.

### Modules built or modified

- **Core schemas.** `UpdateDocumentDTOSchema.name` tightened;
  `DocumentItemSchema.chunkCount` added.
- **Backend handlers.** `download-document` (adds
  `ResponseContentDisposition`); `edit-document` (uniqueness check,
  correct audit action, chunk-metadata propagation).
- **Backend helpers.** `helpers/document.ts` `deleteDocument` reorders
  and stops swallowing errors; `helpers/pinecone.ts` `deleteFromPinecone`
  uses `chunkCount` when present; index-write path persists `chunkCount`.
- **Async rename worker (conditional).** Only if the `> 1 000`-chunk path
  is exercised — SQS queue + consumer Lambda + CDK route.
- **Frontend hook.** `useUpdateDocument` URL fixed.
- **Frontend components.** `DocumentCard` gains inline rename UI, drops
  the ownership guard, wraps Download in a permission-aware component;
  `KnowledgeBaseItemComponent` swaps `window.open` for `<a download>`
  click.

### API contracts

- `PATCH /document/edit-document` — request body `UpdateDocumentDTO`
  (name trimmed, 1–255). Response `200` on success, `409` on duplicate
  name with `{ message }`, `400` on validation error.
- `GET /document/download-document` — response now includes a `url` whose
  disposition is `attachment; filename*=UTF-8''<encoded current name>`.
- `DELETE /document/delete-document` — unchanged shape; failure modes
  become louder (Pinecone / S3 errors bubble to the client).

## Testing Decisions

Good tests here assert external behaviour — what the handler returns for
a given input, what the component renders and dispatches for a given
click — not the concrete DynamoDB calls or which Pinecone method was
called in which order. Mocks live at the AWS SDK / Pinecone client
boundary; everything inside is exercised.

### Seams

- **Backend business functions (primary seam).** Jest against the
  exported business function of each touched module — not the middy
  wrapper. One per module. This is where the bulk of coverage lives:
  - `downloadDocument` — asserts the returned URL carries a
    `response-content-disposition` reflecting the current DDB name,
    including RFC-5987 encoding for non-ASCII.
  - `editDocument` — happy rename, empty / whitespace / too-long
    rejection, duplicate-name 409, audit-action assertion, chunk-metadata
    propagation for the inline path, enqueue for the async path.
  - `deleteDocument` — order (Pinecone → S3 → DDB), Pinecone failure
    aborts (DDB row preserved), S3 failure aborts (DDB row preserved),
    happy path.
  - `deleteFromPinecone` — deterministic ID construction when
    `chunkCount` is present; paginated fallback when it isn't.
- **`DocumentCard` component.** RTL. Rename happy path, empty-name
  rejection (client-side), 409 surface, Download button visible with
  `document:read` and hidden without, pencil icon visible with
  `document:edit` and hidden without.
- **`UpdateDocumentDTOSchema`.** Vitest. Trim, min(1), max(255),
  optional-when-absent.
- **Optional E2E.** Single Cypress spec
  (`apps/web/cypress/e2e/09b-org-documents-doc-crud.cy.js`) covering
  upload → rename → download → delete for a real document. May land
  after the code PR.

### Prior art

- Backend handler tests co-located with source in
  `apps/functions/src/handlers/document/*.test.ts` (existing pattern:
  mock middy + AWS SDK before imports, call the exported business
  function directly).
- Pinecone helper tests: co-located `pinecone.test.ts` uses a mocked
  Pinecone client and asserts the shape of arguments.
- Schema tests: co-located `packages/core/src/schemas/*.test.ts` uses
  Vitest and asserts `safeParse` results.
- RTL card tests: existing tests under `apps/web/components/kb/**`
  render the card with a permissions provider and assert visibility.
- Cypress: `apps/web/cypress/e2e/09-*.cy.js` establishes the CRUD
  pattern.

## Out of Scope

- RFP-attached documents (`rfp-document/*` routes and the
  `opportunity-rfp-documents` surface).
- In-flight Step Function cancellation on delete (i.e. `SendTaskFailure`
  against the pipeline `taskToken`).
- Cache invalidation beyond SWR: `compliance-review-doc-cache`,
  answer-generation retrieval caches.
- File-extension enforcement on rename. Renaming to a name without an
  extension is allowed.
- Preview / open-in-tab as a separate action.
- Reconciliation job for existing orphan chunks. Backfill of `chunkCount`
  on legacy `DocumentItem`s is a follow-up.
- Freshness (`ACTIVE / WARNING / STALE / ARCHIVED`) — orthogonal, driven
  by the stale-content-detection stack.

## Further Notes

- **`document:edit` role coverage.** Confirm the roles that can upload
  can also rename before merging. If not, we ship a UI where users can
  add docs but can't clean up their names.
- **Uniqueness race.** Query + write in the rename handler is not atomic
  in DynamoDB — two concurrent renames to the same target both pass the
  check. Accepted risk, rare in practice.
- **RFC 5987 encoding.** S3's `ResponseContentDisposition` is passed
  verbatim into the signed URL. Use the same encoder as any existing
  `Content-Disposition` producer (likely already present under
  `rfp-document/`).
- **Pinecone `index.update()` throughput.** Sequential loop is too slow
  for the 1 000-chunk cap under a default Lambda timeout — batch with
  `Promise.all` in groups of ~50, or raise the handler timeout.
- **Legacy docs without `chunkCount`.** Any doc indexed before D-7
  ships falls back to the query-loop path. A one-time backfill script to
  populate `chunkCount` from Pinecone is a follow-up, not part of this
  spec.
