# Org Documents (Knowledge Base) — Download, Rename, Delete Hardening

Scope: the "Org Documents" surface at
`/organizations/[orgId]/knowledge-base/[kbId]` (the Document Hub / knowledge
base). Not RFP-attached documents.

Derived from `docs/org-documents-improvement/task` and the grilling session
that turned three bullets into an implementable plan.

---

## 1. Actual state of the world (as of develop)

The task bullets read as greenfield work; they aren't. Most surface exists —
the gaps are frontend wiring, permission logic, and a couple of correctness
bugs.

- **Download.** Backend handler `apps/functions/src/handlers/document/download-document.ts`
  and hook `useDownloadDocument` (`apps/web/lib/hooks/use-document.ts:77`)
  already exist. The KB page `KnowledgeBaseItemComponent.tsx` already threads
  `onDownload` into `DocumentCard`. The button is invisible for anyone who
  isn't the uploader because of the client-side guard
  `DocumentCard.tsx:96` — `(!doc.createdBy || doc.createdBy === userSub)`.
  Backend explicitly permits any org member with `document:read` — the
  frontend gate is the bug.

- **Rename.** Handler `edit-document.ts` and route `PATCH document/edit-document`
  exist. Hook `useUpdateDocument` (`use-document.ts:48`) points at
  `document/update-document` — **wrong path**. No rename UI on the card. The
  audit action is mislabelled as `DOCUMENT_VIEWED`
  (`edit-document.ts:66`). `UpdateDocumentDTOSchema.name` is
  `z.string().optional()` — no trim, no min/max, empty string accepted.

- **Delete.** `deleteDocument` in `apps/functions/src/helpers/document.ts:39`
  deletes S3 (both keys) + Pinecone + DDB row. `deleteFromPinecone`
  (`pinecone.ts:158`) finds chunk IDs via a zero-vector query
  `topK: 10000` filtered by SK metadata, then `deleteMany`. Two problems:
    1. `document.ts:88-89` catches Pinecone errors and continues. The DDB row
       is deleted even if Pinecone deletion failed → orphan chunks.
    2. `topK: 10000` is a hard cap. Docs with more than 10 000 chunks orphan
       silently.

---

## 2. Decisions (from the grill)

Every decision below is the outcome of an explicit choice — the alternatives
are recorded in the punch list for context.

### D-1  Download button is gated by RBAC only

- Drop the `createdBy === userSub` guard on `DocumentCard.tsx:96`.
- Render the download button through `PermissionButton` (or a matching
  permission-aware wrapper) with `requiredPermission="document:read"`.
- No-permission users see no button — matches the create/delete pattern
  already on the card.

### D-2  Download performs a real "Save As", not open-in-tab

- `download-document.ts` sets `ResponseContentDisposition` on the
  `GetObjectCommand`:
  `attachment; filename="<ascii-fallback>"; filename*=UTF-8''<rfc5987>`.
  The presigned URL therefore signs the disposition header — browsers honour
  it.
- Frontend switches from `window.open(url, '_blank')` to an
  `<a href download>` click:
    ```ts
    const a = document.createElement('a');
    a.href = result.url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    ```
- `fileName` in the response uses the current DDB `document.name` — rename
  therefore flows through to the downloaded filename on next click.

### D-3  Rename via inline edit on `DocumentCard`

- Pencil icon next to the doc name; click switches the name to an `<Input>`,
  Enter / blur commits, Escape cancels.
- Uses `useUpdateDocument`, fixed to `PATCH document/edit-document`.
- Card is gated by `document:edit` — no icon if the user lacks it.
- Optimistic update via SWR `mutate` on `useDocumentsByKb`; rollback on
  API error.

### D-4  Rename validation

- **Trim + non-empty, 1–255 chars.** Added to `UpdateDocumentDTOSchema.name`:
  `z.string().trim().min(1).max(255).optional()`.
  Same rule mirrored on the frontend input.
- **Unique within KB, case-insensitive.** Enforced server-side in the edit
  handler: query docs in the same `knowledgeBaseId`, lower-case compare, skip
  the target's own SK. Return `409` on conflict with
  `{ message: 'A document with this name already exists in this knowledge base.' }`.
  Frontend surfaces the message inline.
- **File extension is _not_ enforced.** The user can rename `report.pdf` to
  `Final report` — download will still produce a file whose extension the
  browser derives from Content-Disposition + Content-Type. No backend logic
  guards this.
- **Audit action fixed** to `DOCUMENT_RENAMED` (or `DOCUMENT_UPDATED`) —
  today it's `DOCUMENT_VIEWED`.

### D-5  Rename propagates to Pinecone chunk metadata

Chunks store `documentName` in metadata (`pinecone.ts:132`). If we don't
update, source citations in answer-generation show the old name.

- **Default path: inline** in the rename handler.
- **Safety valve: cap at 1 000 chunks.**
    - Handler counts chunks first (metadata-filter query).
    - `count ≤ 1 000` → update inline: `for id in ids: index.update(id, { metadata: { documentName } })`.
    - `count > 1 000` → DDB write returns 200 immediately; chunk update is
      enqueued (SQS or Step Function — see §5).
- DDB write always succeeds before the Pinecone loop starts. If the Pinecone
  loop later fails, we log + accept eventual inconsistency (name in list is
  correct; citations may be stale until next reindex).

### D-6  Delete uses fail-fast ordering, DDB row is the commit marker

New order in `deleteDocument`:

1. Load DDB item.
2. Delete Pinecone chunks. **Rethrow on failure** — remove the try/catch at
   `document.ts:86-90`.
3. Delete S3 objects (both keys). Rethrow on failure.
4. Delete DDB row last.

If any step fails, the DDB row survives → the doc still appears in the KB
list → the user retries. No new state machine, no `DELETING` status, no
reconciliation job.

### D-7  Pinecone delete no longer relies on `topK: 10000`

Rewrite `deleteFromPinecone`:

- List chunk IDs by paginating the metadata-filtered query (or, better,
  compute them deterministically from the known chunk-count metadata on the
  document — chunk IDs are `${sk}#${chunkKey}` per `pinecone.ts:121`, so if
  we persist `chunkCount` on the `DocumentItem`, we don't need to query at
  all).
- Preferred: **track `chunkCount` on `DocumentItem`** at index time. Delete
  becomes `deleteMany([...Array(chunkCount)].map((_, i) => \`${sk}#${chunkKey(i)}\`))`
  — no query round-trip, no cap, deterministic.
- Fallback if `chunkCount` is missing (legacy items): current
  query-then-delete path, but loop until `matches` returns empty. Log a
  warning on any legacy fallback.

### D-8  Cache invalidation on delete: SWR only

- Confirm `refreshDocuments()` (SWR `mutate` on `useDocumentsByKb`) runs
  after delete — it already does (`KnowledgeBaseItemComponent.tsx:93`).
- Also invalidate `useDocument(docId, kbId)` if any deep-linked route caches
  it.
- **Explicitly deferred:** `compliance-review-doc-cache` DDB entries,
  answer-generation retrieval caches, Step-Function `taskToken`
  cancellation. Follow-up ticket if any of those are observed to leak stale
  data.

### D-9  Non-owner UX

- Both Download and Rename icons are hidden entirely when the user lacks
  the corresponding permission (`document:read` / `document:edit`). No
  disabled-with-tooltip variant.

---

## 3. Explicitly out of scope

- RFP-attached documents (`rfp-document/*` routes / `opportunity-rfp-documents`).
- In-flight Step Function cancellation on delete.
- Cache invalidation beyond SWR.
- File-extension enforcement on rename.
- Preview / open-in-tab as a separate action.
- Reconciliation job for orphan cleanup.

---

## 4. Bugs surfaced along the way

Small enough to fold into the same PR:

| # | File | Bug |
| --- | --- | --- |
| B-1 | `apps/web/lib/hooks/use-document.ts:50` | `useUpdateDocument` PATCHes `document/update-document`, real route is `document/edit-document`. |
| B-2 | `apps/functions/src/handlers/document/edit-document.ts:66` | Audit action is `DOCUMENT_VIEWED`, should be `DOCUMENT_RENAMED` / `DOCUMENT_UPDATED`. |
| B-3 | `apps/functions/src/helpers/document.ts:86-90` | Pinecone-delete error is swallowed — DDB row is still deleted → orphan chunks. |
| B-4 | `apps/functions/src/helpers/pinecone.ts:162-169` | `topK: 10000` cap on delete-by-metadata query. |
| B-5 | `packages/core/src/schemas/document.ts:43` | `UpdateDocumentDTOSchema.name` has no trim/min/max — empty rename accepted. |
| B-6 | `apps/web/components/kb/components/DocumentCard.tsx:96` | Download button hidden unless `createdBy === userSub`; backend permits any `document:read`. |

---

## 5. Punch list

Ordered by dependency, not priority. Every line is intended to be small.

### Core schemas — `packages/core`
- [ ] `document.ts`: tighten `UpdateDocumentDTOSchema.name` to
      `z.string().trim().min(1).max(255).optional()`. Rebuild.
- [ ] Consider adding `chunkCount?: z.number().int().nonnegative()` to
      `DocumentItemSchema` for D-7.

### Backend — `apps/functions`
- [ ] `handlers/document/download-document.ts`: append
      `ResponseContentDisposition` to the `GetObjectCommand`, RFC-5987 encode
      the filename.
- [ ] `handlers/document/edit-document.ts`:
    - [ ] Change audit action to `DOCUMENT_RENAMED`.
    - [ ] Before writing, query `queryBySkPrefix` for the KB, lower-case
          compare names, return 409 on conflict.
    - [ ] After DDB update, if `name` changed: count chunks. If
          `≤ 1 000`, run inline `index.update()` loop for `documentName`.
          If `> 1 000`, enqueue an async job.
    - [ ] Log + swallow Pinecone update failures (DDB write already
          committed).
- [ ] `helpers/document.ts` (`deleteDocument`):
    - [ ] Reorder: Pinecone → S3 → DDB.
    - [ ] Remove `try/catch` that swallows Pinecone errors.
- [ ] `helpers/pinecone.ts` (`deleteFromPinecone`):
    - [ ] Use `chunkCount` when present to build the ID list directly.
    - [ ] Legacy fallback: paginate the query loop until empty.
- [ ] Index-write path (`indexIntoPinecone` or equivalent):
    - [ ] Persist `chunkCount` back onto the DDB `DocumentItem` when
          indexing completes.
- [ ] (If D-5 async path is taken) new SQS queue + consumer Lambda
      `handlers/document/rename-chunks-worker.ts` that iterates
      `index.update()` over chunk IDs. CDK route in `packages/infra`.
- [ ] Tests co-located with each handler/helper touched.

### Frontend — `apps/web`
- [ ] `lib/hooks/use-document.ts:50`: fix URL to `document/edit-document`.
- [ ] `components/kb/components/DocumentCard.tsx`:
    - [ ] Remove `createdBy === userSub` guard on the DownloadButton.
    - [ ] Wrap DownloadButton in a permission-aware component
          (`PermissionButton requiredPermission="document:read"` or the
          existing `Permission*` variant of `DownloadButton`).
    - [ ] Add inline rename UI: pencil icon → editable input, Enter commits,
          Escape cancels. Show inline error on 409.
    - [ ] Wire rename to `useUpdateDocument`; call `mutate` on
          `useDocumentsByKb` (optimistic + rollback).
- [ ] `components/kb/KnowledgeBaseItemComponent.tsx`:
    - [ ] Update download handler to trigger an `<a download>` click instead
          of `window.open`.
- [ ] Tests: RTL for the card (rename happy path, empty rejection, 409
      surface, download visible/hidden by permission).

### E2E — `apps/web/cypress` (optional in this PR)
- [ ] Add a `09b-org-documents-doc-crud.cy.js` covering upload → rename →
      download → delete for a real doc, once the UI is in place.

---

## 6. Open questions / risks

- **`document:edit` role coverage.** Confirm the same roles that can upload
  can also rename. If not, we ship a UI where users can add docs but can't
  clean up their names. Grep the RBAC config before merging.
- **Race on rename uniqueness.** Query + write in the handler is not atomic
  in DynamoDB. Two concurrent renames to the same target both pass the
  check. Rare enough to accept.
- **RFC 5987 encoding.** S3's `ResponseContentDisposition` is passed
  verbatim into the signed URL; must be a valid HTTP header value. Use the
  same encoder as any existing `Content-Disposition` producer in the repo
  (grep first — likely `rfp-document/get-document-download-url.ts`).
- **Pinecone `index.update()` throughput.** Serverless Pinecone tolerates
  concurrent updates well; sequential loop at ~50 ms/call → 1 000 chunks in
  ~50 s. That's over Lambda default 30 s — the handler needs
  `timeoutSeconds: 60` at minimum, or parallelise with `Promise.all` in
  batches of 50. Prefer batching.
- **Legacy docs without `chunkCount`.** Any doc indexed before D-7 ships
  falls back to the query-loop path. Consider a one-time backfill script to
  populate `chunkCount` from Pinecone.
