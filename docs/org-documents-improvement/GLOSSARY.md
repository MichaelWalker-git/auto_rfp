# Glossary — Org Documents

Terms as used in this feature area. Where a term is ambiguous elsewhere in
the codebase, this file records the meaning that applies inside
`docs/org-documents-improvement/`.

## Domain

- **Org Documents.** User-facing label for a knowledge base's document list.
  Reachable at `/organizations/[orgId]/knowledge-base/[kbId]`. Distinct from
  **RFP Documents**, which are documents attached to a specific project /
  opportunity under `rfp-document/*` routes.
- **Knowledge Base (KB).** Container for documents ingested for retrieval.
  Identified by `kbId`. A single organization has many KBs.
- **Document.** A single uploaded file (PDF / DOCX / TXT / etc.) inside a
  KB. Represented by `DocumentItem`. Owns an original file
  (`fileKey`), an extracted-text file (`textFileKey`), and — once indexed —
  a set of Pinecone chunks.
- **Chunk.** A slice of the extracted text (~a few hundred tokens) that has
  been embedded and stored as a single Pinecone vector. Chunk ID has the
  shape `${SK}#${chunkKey}` where `SK = KB#<kbId>#DOC#<docId>`.
- **Indexed.** Terminal-success state for a document
  (`indexStatus: 'INDEXED'`). All chunks are written to Pinecone.
- **Freshness.** Orthogonal per-document status (`ACTIVE / WARNING / STALE /
  ARCHIVED`) driven by the stale-content-detection stack. Not touched by
  this task.

## Backend surfaces

- **`DocumentItem`.** Zod schema in `packages/core/src/schemas/document.ts`.
  Stored in DynamoDB under `PK = DOCUMENT_PK`, `SK = KB#<kbId>#DOC#<docId>`.
- **`UpdateDocumentDTO`.** Body of `PATCH /document/edit-document`. Only
  `name` is user-facing in this feature.
- **`DeleteDocumentDTO`.** Body of `DELETE /document/delete-document`.
  Carries `orgId` (Pinecone namespace), `knowledgeBaseId`, `id`.
- **`buildDocumentSK(kbId, docId)`.** Helper that produces the DDB sort key
  used everywhere; also the value the Pinecone chunk metadata field
  `SK_NAME` holds.
- **`fileKey`.** S3 key for the original uploaded binary. Immutable after
  upload — rename does *not* rewrite this.
- **`textFileKey`.** S3 key for the extracted-text sidecar produced by the
  document pipeline.
- **`chunkCount`.** New optional field on `DocumentItem` proposed in D-7.
  Persisted at index time. Enables deterministic chunk-ID reconstruction on
  delete / rename.
- **`taskToken`.** Step Function callback token stored on the item while a
  pipeline execution is in flight. Present only during processing.
- **RBAC permissions used here.**
    - `document:read` — see + download documents.
    - `document:edit` — rename.
    - `document:delete` — delete.
    - `kb:upload` — add new documents.

## Frontend surfaces

- **`KnowledgeBaseItemComponent`.** The Org Documents page.
- **`DocumentCard`.** Single-row card rendered for each document in the KB.
  Home for the download / rename / delete controls.
- **`useDocumentsByKb(kbId)`.** SWR hook feeding the list. `mutate()` on
  this key is the primary cache-invalidation mechanism for create / rename
  / delete.
- **`useUpdateDocument`.** Mutation hook for rename. In this task it is
  fixed to `PATCH document/edit-document` (currently points at
  `document/update-document`, a route that doesn't exist).
- **`useDownloadDocument`.** Returns `{ url, method, fileName, expiresIn }`.
  The URL is a short-lived (`PRESIGN_EXPIRES_IN`, default 900 s) presigned
  S3 GET.
- **`PermissionButton` / `PermissionDeleteButton`.** Wrappers that hide the
  button when the current user lacks the required permission. In this task
  the download button will use the same pattern.

## Storage & infra

- **Pinecone namespace.** Documents are namespaced by `orgId` in the shared
  Pinecone index. Chunks belonging to a document are found via metadata
  filter on `SK_NAME` — or by reconstructing the ID list from `chunkCount`.
- **Documents bucket.** S3 bucket referenced by env `DOCUMENTS_BUCKET`.
  Holds both `fileKey` and `textFileKey` objects.
- **`ResponseContentDisposition`.** Query parameter on a presigned S3 GET
  URL that becomes the object's `Content-Disposition` header when
  downloaded. This task uses it to force `attachment; filename=…` for the
  download button (D-2).
- **`SendTaskFailure`.** Step Functions API for cancelling an in-flight
  execution via its `taskToken`. *Not* invoked by this task (out of scope);
  documented here because it's the natural extension point if in-flight
  delete becomes a real problem.

## States that matter

- `indexStatus`.
    - `pending` — DDB row exists, file uploaded, pipeline not yet finished.
    - `TEXT_EXTRACTED`, `CHUNKED` — mid-pipeline.
    - `INDEXED` / `ready` — terminal success.
    - `failed`, `TEXT_EXTRACTION_FAILED` — terminal failure.
- Download is permitted from any state where `fileKey` is set (which is
  all of them, from `pending` onward).
- Rename is permitted from any state — it only touches DDB and (post-index)
  Pinecone metadata.
- Delete is permitted from any state. In-flight-pipeline handling is out of
  scope; race outcomes are documented as an accepted risk.
