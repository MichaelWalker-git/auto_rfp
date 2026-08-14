# Cross-Package AI Editing ("Mass Edit") — Implementation Plan

> **STATUS (2026-08-10):** Design doc. Nothing built yet. This is Ticket 2 from
> `we-have-two-tickets-virtual-island.md`, re-scoped after a design session that
> resolved four open questions (forms editable in Stage 1, inline "Edit with AI"
> on finding cards, unified review+edit chat, and edit history for forms).
> Ticket 1 (AI Compliance Review) is **merged** (#308) and is the foundation this
> builds on. The DOCX form filler (#316) is **merged**, so the original DOCX-form
> blocker is lifted — all three form types (PDF/XLSX/DOCX) are writable.

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Feature** | A chat that carries a single edit across every RFP document **and** required form in a package, via **propose-then-confirm**. |
| **Two triggers** | (a) fix a disagreement ("cost differs — make it $2.4M everywhere"); (b) propagate a change ("phone number is now X — update everywhere"). |
| **Surfaces** | (1) a package-edit panel next to the compliance panel; (2) inline **"Edit with AI"** on a compliance finding card, pre-seeded from the finding; (3) the **unified** compliance chat, which detects edit vs review intent. |
| **Safety model** | Propose-then-confirm. The AI never writes directly. It drafts every before→after; the user reviews a diff and confirms; apply is guarded per-target (re-verify `before`, skip+report stale). |
| **History** | Document edits auto-version (existing). Form edits get a **new form-versioning mechanism** (this ticket) so form writes are equally revertible. |
| **Export** | Untouched. Edits persist to the normal save path export already reads; no special markup. |

### The four resolved design questions

1. **Forms editable in Stage 1.** Client requirement. Apply targets both RFP
   documents (HTML) and required forms (fields), in one batch.
2. **Inline "Edit with AI" on finding cards.** A finding pre-seeds the edit
   instruction so the user fixes an inconsistency without leaving the card.
3. **Unified review+edit chat with intent routing.** One agentic chat: ask a
   question → review answer; ask to change something → edit proposals. **Tool-based
   routing** (the model picks `propose_edits` vs read tools).
4. **Form edit history.** Forms have **no versioning today** (documents do). This
   ticket adds a `RequiredFormVersion` entity so AI (and manual) form edits are
   revertible — parity with documents.

### The 29s problem and how this design avoids it

The compliance **chat** is bound by API Gateway's hard 29s limit. A cross-package
edit must read *every* document + form to find *every* occurrence of a value —
that scan cannot fit in 29s on a large package. Resolution: **split the work by
cost, and push the expensive step off the request path** — exactly the pattern
the compliance **Full Review** already uses.

```
┌─ Chat turn ─────────────┐   ┌─ Propose (scan) ────────────┐   ┌─ Apply ─────────────────┐
│ SYNC · Haiku · <29s     │   │ ASYNC · Sonnet · SQS worker │   │ SYNC · NO LLM           │
│ answer a question       │   │ read whole package          │   │ guarded per-target write│
│  OR detect edit intent  │──▶│ draft every before→after    │──▶│ re-verify `before`      │
│  → enqueue a proposal   │   │ → status PROPOSED           │   │ skip+report if stale    │
│    run (returns 202)    │   │ (UI polls, like Full Review)│   │ version-snapshot each   │
└─────────────────────────┘   └─────────────────────────────┘   └─────────────────────────┘
```

- **The 29s ceiling only ever touches the cheap chat turn** (routing + parameter
  extraction — not the scan).
- **The scan runs async** (Sonnet, 15-min Lambda), identical to the Full Review
  worker. UI polls a `GET .../run` endpoint exactly like `useReviewRun`.
- **Apply calls no model at all** — it's deterministic guarded string/field
  replacement, so it's fast and safe under any timeout.

This is why tool-based unified chat works: an "edit" intent doesn't try to scan
inline — the `propose_edits` tool **enqueues** the async run and the chat turn
returns immediately with `{ runId, status: 'PROPOSING' }`.

---

## 2. Architecture Overview <!-- ✅ IMPLEMENTED -->

```
                              ┌──────────────────────────────────────────────┐
   User (3 entry points)      │  apps/web/features/package-edit               │
   ─────────────────────      │                                              │
   1. PackageEditPanel        │  PackageEditPanel ── usePackageEdit (chat)   │
   2. FindingCard "Edit AI" ──┼─▶ (seeds instruction from finding)           │
   3. Unified compliance chat │  ProposalRunView ── usePackageEditRun (poll) │
                              │  ProposalDiffCard ── (reuse VersionDiffView)  │
                              └───────────────┬──────────────────────────────┘
                                              │  REST (Cognito)
             ┌────────────────────────────────┼────────────────────────────────┐
             ▼                                 ▼                                 ▼
   POST /package-edit/chat          GET /package-edit/run          POST /package-edit/apply
   SYNC · proposal:edit             poll · proposal:edit           SYNC · proposal:edit
   (Haiku: route intent)            (returns run + proposals)      (guarded writes, NO LLM)
        │  edit intent                                                      │
        │  → createProposalRun (PROPOSING, 409 if active)                   │
        │  → enqueue SQS                                                    │ per target:
        ▼                                                                   │  ├ RFP_DOCUMENT → updateRFPDocumentWithContent (auto-versions)
   ┌─────────────────────────┐                                             │  └ FORM → snapshot fields → updateRequiredForm
   │ package-edit-worker.ts  │  SQS · Sonnet · 15-min Lambda               ▼
   │ runProposeEdits:        │                                     per-target result:
   │  buildPackageInventory  │  ◀── reuses compliance-review-tools  applied | skipped-stale | failed
   │  agentic scan           │
   │  draft before→after     │  → markRunProposed(run, proposals)
   │  validate `before` real │
   └─────────────────────────┘
```

### Technology decisions

| Concern | Decision | Rationale |
|---|---|---|
| Chat turn | Sync, Haiku, `timeoutSeconds: 60` route | Cheap intent-routing only; stays under 29s. Mirrors `edit-section.ts` / compliance `chat.ts`. |
| Proposal scan | Async SQS worker, Sonnet, 15-min Lambda | Cross-package scan can't fit in 29s. Clone of `review-worker.ts`. |
| Apply | Sync, no LLM | Deterministic guarded replace. No model latency/cost. |
| Intent routing | Tool-based (`propose_edits` tool in one loop) | No separate classifier call; the model's tool choice *is* the routing. |
| Doc writes | `updateRFPDocumentWithContent` (existing) | Auto-snapshots a version (`rfp-document.ts:440-456`); export already reads this path. |
| Form writes | New `RequiredFormVersion` snapshot + `updateRequiredForm` | Forms have no history today; this adds parity + revert. |
| Concurrency | Single active proposal run per opportunity (409) | Same guard as `createReviewRun`. |
| Staleness | Snapshot version ids; re-verify `before` at apply | No lock. Skip+report stale targets. Mirrors compliance snapshot. |

---

## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->

Two new schema files in `packages/core/src/schemas/`. Rebuild core after
(`pnpm --filter @auto-rfp/core build`) and add both to the `index.ts` barrel.

### 3a. `package-edit.ts`

```typescript
import { z } from 'zod';
import { FindingAnchorSchema } from './compliance-review'; // reuse the discriminated-union anchor

// ── Edit target ──────────────────────────────────────────────────────────────
// An edit points at either an HTML RFP document or a required-form field.
export const EditTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('RFP_DOCUMENT'),
    documentId: z.string(),
    documentTitle: z.string().optional(),
    // Where in the document (reuse the compliance heading anchor for localization).
    anchor: FindingAnchorSchema.optional(),
  }),
  z.object({
    kind: z.literal('FORM'),
    formId: z.string(),
    formTitle: z.string().optional(),
    fieldId: z.string(),         // exact fieldId from get_form_fields
    fieldLabel: z.string().optional(),
  }),
]);
export type EditTarget = z.infer<typeof EditTargetSchema>;

// ── A single proposed edit (drafted by the async worker, applied on confirm) ──
export const ProposedEditSchema = z.object({
  editId: z.string(),            // model/worker-generated unique id
  target: EditTargetSchema,
  before: z.string(),            // VERBATIM current text/value (the apply guard checks this)
  after: z.string(),             // the replacement
  rationale: z.string(),         // one-line "why", shown on the diff card
  // Stage-1 advisory: a FORM edit shown for visibility only when forms are out of
  // scope for a given run. With forms in Stage 1 this is normally false, but the
  // flag stays so a future read-only mode is expressible.
  advisoryOnly: z.boolean().default(false),
});
export type ProposedEdit = z.infer<typeof ProposedEditSchema>;

// ── Proposal run (async lifecycle — mirrors ComplianceReviewRun) ─────────────
export const PackageEditRunStatusSchema = z.enum(['PROPOSING', 'PROPOSED', 'FAILED']);
export type PackageEditRunStatus = z.infer<typeof PackageEditRunStatusSchema>;

export const PackageEditRunSchema = z.object({
  runId: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  oppId: z.string(),
  status: PackageEditRunStatusSchema,
  instruction: z.string(),       // the user's edit request that seeded this run
  proposals: z.array(ProposedEditSchema).default([]),
  snapshotVersionIds: z.record(z.string(), z.string()).default({}), // docId/formId → version, for staleness
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  ttl: z.number().optional(),    // epoch seconds; table TTL already enabled
});
export type PackageEditRun = z.infer<typeof PackageEditRunSchema>;

// ── Chat (unified surface reuses this; standalone panel also uses it) ────────
export const PackageEditChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type PackageEditChatRequest = z.infer<typeof PackageEditChatRequestSchema>;

// A chat turn either answers (review intent) or kicks off a proposal run (edit intent).
export const PackageEditChatResponseSchema = z.object({
  messageId: z.string(),
  answer: z.string(),            // human-readable reply either way
  intent: z.enum(['REVIEW', 'EDIT']),
  runId: z.string().optional(),  // present when intent === 'EDIT' (poll GET /run)
});
export type PackageEditChatResponse = z.infer<typeof PackageEditChatResponseSchema>;

// ── Apply (confirmed; guarded; per-target result) ───────────────────────────
export const ApplyEditsRequestSchema = z.object({
  runId: z.string(),
  editIds: z.array(z.string()).min(1),
});
export type ApplyEditsRequest = z.infer<typeof ApplyEditsRequestSchema>;

export const EditApplyResultSchema = z.object({
  editId: z.string(),
  status: z.enum(['applied', 'skipped-stale', 'failed']),
  message: z.string().optional(),
  newVersionNumber: z.number().optional(),   // for RFP_DOCUMENT and FORM (both versioned now)
});
export type EditApplyResult = z.infer<typeof EditApplyResultSchema>;

export const ApplyEditsResponseSchema = z.object({
  results: z.array(EditApplyResultSchema),
});
export type ApplyEditsResponse = z.infer<typeof ApplyEditsResponseSchema>;

export const GetPackageEditRunResponseSchema = z.object({
  run: PackageEditRunSchema.nullable(),
});
export type GetPackageEditRunResponse = z.infer<typeof GetPackageEditRunResponseSchema>;
```

### 3b. `required-form-version.ts` (NEW — form history parity)

Mirrors `RFPDocumentVersionSchema`, but the form's content is its `fields` array,
not S3 HTML. We snapshot the compressed fields alongside metadata.

```typescript
import { z } from 'zod';
import { DetectedFormFieldSchema } from './required-form';

/**
 * A snapshot of a required form's fields at a point in time. Created before any
 * mutating write (AI mass-edit OR manual field save) so form edits are revertible.
 * Forms had NO history before this; documents already auto-version.
 */
export const RequiredFormVersionSchema = z.object({
  versionId: z.string(),
  formId: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  versionNumber: z.number().int().min(1),
  // The snapshot: the full fields array as it was BEFORE this version's write.
  // Stored compressed in DynamoDB (same gzip trick as required-form.ts fieldsGz).
  fields: z.array(DetectedFormFieldSchema),
  source: z.enum(['MANUAL', 'AI_MASS_EDIT', 'AI_FILL', 'SYSTEM']).default('MANUAL'),
  changeNote: z.string().max(500).optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
  createdAt: z.string(),
});
export type RequiredFormVersion = z.infer<typeof RequiredFormVersionSchema>;
```

> **Note:** the 5-type entity pattern in `.claude/rules/03-entity-definitions.md`
> applies to primary stored entities. `PackageEditRun` and `RequiredFormVersion`
> are run/snapshot records that follow the precedent of `ComplianceReviewRun` and
> `RFPDocumentVersion` respectively (single Item schema + response wrappers), not
> the full Create/Update/List projection set. Match those existing files.

---

## 4. DynamoDB Design <!-- ✅ IMPLEMENTED -->

### PK constants — `apps/functions/src/constants/package-edit.ts`

```typescript
export const PACKAGE_EDIT_RUN_PK = 'PACKAGE_EDIT_RUN';
export const PACKAGE_EDIT_CHAT_PK = 'PACKAGE_EDIT_CHAT';
// Tuning (mirror compliance-review constants):
export const MAX_TOOL_ROUNDS_CHAT = 3;      // intent + light extraction only
export const MAX_TOOL_ROUNDS_PROPOSE = 12;  // full scan (worker)
export const MAX_TOKENS_CHAT = 4000;
export const MAX_TOKENS_PROPOSE = 24000;
export const RUN_STALE_TIMEOUT_MS = 25 * 60 * 1000; // crash-recovery, > worker Lambda 15m
export const RUN_TTL_DAYS = 90;
```

### Form-version PK — `apps/functions/src/constants/required-form-version.ts`

```typescript
export const REQUIRED_FORM_VERSION_PK = 'REQUIRED_FORM_VERSION';
```

### Access patterns

| Entity | PK | SK | Notes |
|---|---|---|---|
| Package-edit run | `PACKAGE_EDIT_RUN` | `{orgId}#{projectId}#{oppId}#{runId}` | Latest-run query via `queryBySkPrefix` on the opp prefix, newest first. |
| Package-edit chat msg | `PACKAGE_EDIT_CHAT` | `{orgId}#{projectId}#{oppId}#{messageId}` | Only if the standalone panel keeps its own history. Unified chat can reuse compliance chat history instead — see §12. |
| Required-form version | `REQUIRED_FORM_VERSION` | `{orgId}#{projectId}#{oppId}#{formId}#{version:000000}` | Zero-padded version like `rfp-document-version.ts`, newest-first. |

### SK builders — `apps/functions/src/helpers/package-edit.ts` / `required-form-version.ts`

```typescript
export const buildPackageEditRunSk = (orgId, projectId, oppId, runId) =>
  `${orgId}#${projectId}#${oppId}#${runId}`;
export const buildPackageEditRunPrefix = (orgId, projectId, oppId) =>
  `${orgId}#${projectId}#${oppId}#`;

export const buildRequiredFormVersionSk = (orgId, projectId, oppId, formId, version) =>
  `${orgId}#${projectId}#${oppId}#${formId}#${String(version).padStart(6, '0')}`;
export const buildRequiredFormVersionPrefix = (orgId, projectId, oppId, formId) =>
  `${orgId}#${projectId}#${oppId}#${formId}#`;
```

### DynamoDB helpers (wrap `@/helpers/db`)

- `createProposalRun(...)` — 409-guard: fail if an active `PROPOSING` run exists for the opp (conditional create, mirrors `createReviewRun`).
- `getLatestProposalRun`, `getProposalRunById`, `markRunProposed(run, proposals)`, `markRunFailed(run, error)`, `isRunStale(run)`.
- `snapshotFormFields({ form, source, userId })` — reads current form, writes a `RequiredFormVersion` (compress `fields` with the same gzip helper as `required-form.ts`), returns the new version number. **Called before every mutating form write.**
- `listFormVersions`, `getFormVersion`, `revertFormToVersion` — for the form history UI.

---

## 5. Backend — Lambda Handlers <!-- ✅ IMPLEMENTED -->

```
apps/functions/src/handlers/package-edit/
├── chat.ts            POST /package-edit/chat    (sync, Haiku, intent routing)
├── propose-worker.ts  SQS-triggered              (async, Sonnet, drafts proposals)
├── get-run.ts         GET  /package-edit/run     (poll run + proposals + staleness)
├── apply-edits.ts     POST /package-edit/apply   (sync, NO LLM, guarded writes)
└── get-history.ts     GET  /package-edit/history (only if standalone chat keeps history)
```

### 5a. `chat.ts` — sync, intent routing (mirror `compliance-review/chat.ts`)

Thin: query-param `safeParse` (orgId/projectId/opportunityId), body `safeParse`
(`PackageEditChatRequestSchema`), `getOpportunity` → 404, feature-gate. Then a
single bounded Haiku call with **read tools + a `propose_edits` tool**:

- Model answers a question directly → `{ intent: 'REVIEW', answer }`.
- Model calls `propose_edits` (or clearly expresses edit intent) → the handler
  `createProposalRun(...)` (409 if active), snapshots versions, enqueues SQS, and
  returns `{ intent: 'EDIT', answer: 'Analyzing the package…', runId }`.

The chat turn does **not** scan — it routes. The scan is the worker's job. This is
the whole point of the 29s mitigation.

Permission: **`proposal:edit`** (this surface can initiate a mutation flow, unlike
the read-only compliance chat). `proposal:edit` is held by ADMIN + EDITOR only —
`proposal:create` would also admit MEMBER, which is too loose for content edits,
and `proposal:edit` matches the existing `update-rfp-document.ts` write handler.
`orgId` from query string. Non-blocking audit log.

### 5b. `propose-worker.ts` — SQS worker (clone `review-worker.ts` structure)

```typescript
// JobSchema { orgId, projectId, oppId, runId } — same shape as ComplianceReviewJob.
// 1. getProposalRunById → skip if not PROPOSING (idempotent).
// 2. runProposeEdits({ orgId, projectId, oppId, modelId, instruction: run.instruction })
//      - buildPackageInventory (REUSE compliance-review-tools)
//      - agentic invokeClaudeWithTools with COMPLIANCE read tools + propose output schema
//      - validate each proposal's `before` is a real substring / real field value
//        (REUSE the validate-substring logic from compliance-review-validate)
// 3. markRunProposed(run, proposals)   OR   markRunFailed(run, err) + rethrow → DLQ
// 4. Audit log completion/failure (mirror review-worker).
```

Sonnet, 15-min Lambda, `batchSize: 1`, `reportBatchItemFailures: true` — identical
to the compliance worker.

### 5c. `get-run.ts` — poll (mirror `compliance-review/get-review.ts`)

Returns the latest run. Applies crash-recovery (`PROPOSING` past
`RUN_STALE_TIMEOUT_MS` → `FAILED`). The frontend polls while `PROPOSING`.

### 5d. `apply-edits.ts` — the guarded apply loop (NO LLM)

This is the safety core. Per requested `editId`:

**One proposal per occurrence (RESOLVED).** The worker emits a **separate
`ProposedEdit` for each distinct occurrence** of the value, each with its own
anchor/context in `before`, rather than one bulk find-replace. This makes every
change individually reviewable and individually skippable, and it keeps the apply
guard unambiguous (each edit's `before` targets exactly one spot). To keep each
`before` locatable to a single occurrence, the worker includes enough surrounding
context in `before` that it is **unique** within the document (or pairs it with the
anchor's heading/field to disambiguate).

```
RFP_DOCUMENT target:
  1. Load current HTML (loadDocumentHtmlForExport / get-html-content path).
  2. If `before` is NOT a substring of current HTML → result 'skipped-stale'.
  3. If `before` appears MORE THAN ONCE → 'skipped-stale' with message
     "ambiguous — matched N spots" (the worker should have made `before` unique;
     this guard prevents editing the wrong occurrence). Do NOT guess.
  4. Replace the single exact occurrence of `before` with `after`.
  5. Save via updateRFPDocumentWithContent → AUTO-SNAPSHOTS a version.
  6. result 'applied' + newVersionNumber.

FORM target:
  1. getRequiredForm → find field by fieldId.
  2. If field.value !== `before` → result 'skipped-stale'.
  3. snapshotFormFields({ form, source: 'AI_MASS_EDIT', userId })  ← NEW: history parity
  4. updateRequiredForm with the field's value = `after`.
  5. result 'applied' + newVersionNumber.

Any throw on a single target → result 'failed' (message); continue with the rest.
```

Non-atomic, per-target, guarded. Returns `{ results: [...] }`. Non-blocking audit
log capturing before→after for every target (the compliance-tool audit gap taught
us to log mutations). Permission `proposal:edit`.

> **Why guarded-and-skip, not transactional:** matches Ticket 2 decision #10 and
> the compliance snapshot philosophy — never overwrite something that changed
> since it was proposed; report it and let the user re-run.

### 5e. Handler rules (enforced, per `.claude/rules/04`)

- No raw DynamoDB SDK in handlers → domain helpers only.
- `orgId` from query string / body — never `event.auth`.
- `safeParse` destructured.
- `apiResponse` for REST; worker returns void.
- Middy stack: `httpErrorMiddleware → authContextMiddleware → orgMembershipMiddleware → requirePermission('proposal:edit')`, wrapped in `withSentryLambda`.

---

## 6. Reused Building Blocks (no rewrite) <!-- ✅ IMPLEMENTED -->

| Reused from | Used for |
|---|---|
| `compliance-review-tools.ts` (`buildPackageInventory`, `COMPLIANCE_REVIEW_TOOLS`, `get_form_fields`, `get_document_section`) | The worker's read tools — the model reads real content and copies verbatim `before`. **Already size-bounded** (the token-overflow lessons). |
| `compliance-review-validate.ts` (substring validation) | Verify each proposal's `before` is real before persisting. |
| `bedrock-tool-loop.ts` (`invokeClaudeWithTools`) | Both the chat turn and the worker. No rewrite. |
| `review-worker.ts` (SQS worker shape) | Clone for `propose-worker.ts`. |
| `compliance-review-queue.ts` (`enqueue…`) | Clone for `enqueuePackageEditProposal`. |
| `compliance-review-snapshot.ts` (`buildPackageSnapshot`, `isSnapshotStale`) | Staleness + apply-time guard. |
| `updateRFPDocumentWithContent` (`rfp-document.ts:440`) | Document write — auto-versions. |
| `updateRequiredForm` (`required-form.ts`) | Form field write. |
| `VersionDiffView.tsx` | Proposal diff card styling. |
| `useReviewRun.ts` polling pattern | `usePackageEditRun` polling. |

---

## 7. WebSocket Infrastructure <!-- ⏭️ SKIPPED --> (not applicable — REST + polling, like Full Review)

---

## 8. CDK — Routes + Worker <!-- ✅ IMPLEMENTED -->

### `packages/infra/api/routes/package-edit.routes.ts` (mirror compliance-review.routes.ts)

```typescript
export function packageEditDomain(): DomainRoutes {
  return {
    basePath: 'package-edit',
    routes: [
      { method: 'POST', path: 'chat', entry: lambdaEntry('package-edit/chat.ts'),
        timeoutSeconds: 60, memorySize: 512 },
      { method: 'GET',  path: 'run',  entry: lambdaEntry('package-edit/get-run.ts') },
      { method: 'POST', path: 'apply', entry: lambdaEntry('package-edit/apply-edits.ts'),
        timeoutSeconds: 60, memorySize: 512 },
      // Optional (standalone chat history): GET history
    ],
  };
}
```

### `api-orchestrator-stack.ts` changes

1. Create a `packageEditQueue` + DLQ (`maxReceiveCount: 1`, visibility 16m) — the
   worker is a long Sonnet job; don't retry a doomed run. Clone the
   `complianceReviewQueue` block.
2. Add to `commonEnv`: `PACKAGE_EDIT_CHAT_MODEL_ID` (Haiku),
   `PACKAGE_EDIT_WORKER_MODEL_ID` (Sonnet), `PACKAGE_EDIT_QUEUE_URL`.
3. `packageEditQueue.grantSendMessages(sharedInfraStack.commonLambdaRole)`.
4. Create `PackageEditWorker-${stage}` NodejsFunction (15-min timeout, 1024 MB,
   `entry: package-edit/propose-worker.ts`), `addEventSource(SqsEventSource(..., { batchSize: 1, reportBatchItemFailures: true }))`, `grantConsumeMessages`.
5. Register `packageEditDomain()` in `allDomains` **and** a matching entry in
   `domainStackNames` (same index — the file asserts equal length).
6. Per-Lambda log groups come from the shared `NodejsFunction` path; add an
   explicit `LogGroup` for the worker (retention: prod INFINITE / else TWO_WEEKS,
   `removalPolicy: DESTROY`), mirroring `RasterizePdfWorkerLogs`.

**No new IAM** — `commonLambdaRole` already has DynamoDB RW, S3 RW, Bedrock invoke.
Cost note (per `.claude/rules/cost-optimization.md`): reuses PAY_PER_REQUEST table,
HTTP API v2, one extra SQS queue + one worker Lambda. No VPC/NAT/RDS.

---

## 9. Frontend — Hooks & Components <!-- ✅ IMPLEMENTED -->

```
apps/web/features/package-edit/
├── hooks/
│   ├── usePackageEditChat.ts   # sync chat POST (returns intent + optional runId)
│   ├── usePackageEditRun.ts    # SWR GET /run, poll while PROPOSING (reuse useReviewRun pattern)
│   └── useApplyEdits.ts        # apply POST → per-target results; mutate() affected doc/form hooks
├── components/
│   ├── PackageEditPanel.tsx    # standalone panel: chat input + run view
│   ├── ProposalRunView.tsx     # skeleton while PROPOSING; then the proposal list
│   ├── ProposalDiffCard.tsx    # before→after (reuse VersionDiffView), checkbox, re-validate on open
│   └── ApplyResultReport.tsx   # "5 of 6 applied · 1 skipped (changed since proposed)"
├── lib/
│   └── seedInstructionFromFinding.ts  # finding → pre-filled edit instruction (see §10)
└── index.ts                    # barrel
```

Rules: `'use client'`, SWR + `authenticatedFetcher`, `<Skeleton>` (no spinners),
types from `@auto-rfp/core`, barrel imports only, pure-presentation components.

**Poll → apply → refresh:** on apply success, `mutate` the RFP document hooks and
required-form hooks so open editors reflect the new values immediately.

---

## 10. Inline "Edit with AI" on Finding Cards <!-- ✅ IMPLEMENTED -->

Additive change to the compliance feature — `FindingCard.tsx`.

- Add an **"Edit with AI"** button to the card's action row (alongside "Go to
  spot" / Resolve / Dismiss). **Only for Full Review triage findings** — `readOnly`
  chat findings do not show it (they already suppress decision actions).
- Clicking expands an **inline composer inside the card** (Textarea + Send),
  pre-seeded by `seedInstructionFromFinding(finding)`:

  ```typescript
  // e.g. an INCONSISTENCY finding →
  // "The estimated total cost disagrees across documents. The finding notes:
  //  "<snippet>". Make the total consistent everywhere in the package."
  ```

  The user edits/confirms the instruction and sends → `usePackageEditChat` with
  `intent` forced to EDIT (or just POST to the chat endpoint) → a proposal run is
  created → the card shows an inline `ProposalRunView` (poll → diff → apply) **in
  place**, no navigation.

- **Decoupling:** the finding card imports a small seam from the package-edit
  feature (a hook + the inline run view), not the whole panel. Keep the
  cross-feature import via the package-edit **barrel** only.

This is the "fix it where you found it" UX: the finding *is* the edit instruction.

---

## 11. Unified Review + Edit Chat (Intent Routing) <!-- ✅ IMPLEMENTED -->

Two options were considered; **tool-based routing is chosen** because it avoids a
second model round-trip (which the 29s budget can't spare) and makes intent the
model's natural tool selection.

- The compliance chat loop gains one tool: **`propose_edits`** (declared, but its
  "execution" in the sync chat is to **signal edit intent + return the extracted
  instruction** — it does **not** scan). When the model calls it, the handler
  creates a proposal run and enqueues the async worker; the chat response carries
  `{ intent: 'EDIT', runId }`.
- When the model answers with findings/prose instead, `{ intent: 'REVIEW' }`.
- The UI renders **finding cards** for REVIEW turns and an inline **ProposalRunView**
  (poll → diff → apply) for EDIT turns, in the same message stream.

**Permissions (RESOLVED):** the unified chat endpoint gates on **`proposal:edit`**
(it can initiate a mutation). `proposal:edit` is held by ADMIN + EDITOR only, so a
VIEWER/MEMBER/BILLING user cannot start an edit flow — appropriate for writing
package content. The **product ask is one chat**, so this is a single
`proposal:edit` endpoint; read-only users simply won't reach it (or see the edit
affordance). `opportunity:edit` carries the same ADMIN+EDITOR audience and is an
acceptable equivalent if you prefer to scope by opportunity rather than proposal.

> **Note:** because the unified chat is gated `proposal:edit` (stricter than the
> compliance chat's `opportunity:read`), do **not** simply widen the existing
> compliance `chat.ts` — that would lock read-only users out of pure review. Add
> the `propose_edits` capability on a **package-edit chat endpoint** (its own
> `proposal:edit` handler), and let the frontend route the message to the
> compliance chat (review, `opportunity:read`) or the package-edit chat (edit,
> `proposal:edit`) based on the user's permissions. One chat *surface*, two
> permission-scoped endpoints behind it.

---

## 12. Edit History (Answering "are AI edits saved in doc history?") <!-- ✅ IMPLEMENTED -->

| Target | History today | After this ticket |
|---|---|---|
| **RFP document** | ✅ auto-versions on every save (`rfp-document.ts:440-456`) | ✅ unchanged — AI edits appear in the existing version history + are revertible via `revert-version.ts`. |
| **Required form** | ❌ **none** — `updateRequiredForm` overwrites `fields` in place | ✅ **NEW** `RequiredFormVersion` snapshot taken **before** each mutating write; revertible. |

So: **yes for documents (automatically), and yes for forms once §3b/§4 land.** The
form-versioning helper is called by the apply loop **and** should be wired into the
existing manual form-save paths (`save-form-fields.ts`, `update-form-field.ts`) so
manual edits get history too — otherwise history is inconsistent (AI edits tracked,
manual edits not). This is a small, self-contained backend addition that benefits
the whole forms feature, not just AI edits.

**Frontend:** a minimal form-version history + revert affordance in the form editor
(reuse the document version-history UI pattern). Can ship a beat after the backend.

---

## 13. Permissions & RBAC <!-- ✅ IMPLEMENTED -->

| Endpoint | Permission | Why |
|---|---|---|
| `POST /package-edit/chat` | `proposal:edit` | Can initiate a mutation flow (creates a proposal run). ADMIN+EDITOR only. |
| `GET /package-edit/run` | `proposal:edit` | Poll a run the user initiated. (`opportunity:read` acceptable if runs are treated as read-only.) |
| `POST /package-edit/apply` | `proposal:edit` | Mutates documents + forms. |
| Form version revert | `form:edit` | Matches the existing form-field write audience (EDITOR+ADMIN hold `form:edit`). |

**Permission audiences** (from `ROLE_PERMISSIONS`): `proposal:edit` and
`opportunity:edit` are both **ADMIN + EDITOR only** — the right audience for editing
package content. `proposal:create` is broader (also MEMBER) and therefore too loose
for this. `proposal:edit` also matches the existing `update-rfp-document.ts` write
handler. No new permission strings needed — reuse `proposal:edit` / `form:edit`
already in `packages/core/src/schemas/user.ts`. `opportunity:edit` is an accepted
equivalent per the design decision.

---

## 14. Implementation Tickets <!-- ✅ IMPLEMENTED -->

Build order follows `.claude/rules/workflows/implementation.md`: core → constants
→ helpers → handlers → CDK → frontend, typecheck after each.

### PE-0 · Form versioning foundation (schema + helpers) — 3h <!-- ✅ IMPLEMENTED -->
`required-form-version.ts` schema + barrel; `REQUIRED_FORM_VERSION_PK`;
`snapshotFormFields` / `listFormVersions` / `getFormVersion` / `revertFormToVersion`
helpers (gzip fields like `required-form.ts`). **Wire `snapshotFormFields` into
`save-form-fields.ts` + `update-form-field.ts`** so manual edits get history too.
Tests: snapshot round-trip, revert, compression. *(Independent — can start now.)*

### PE-1 · Core schemas — 1h <!-- ✅ IMPLEMENTED -->
`package-edit.ts` (targets, proposed edit, run, chat, apply). Export from barrel.
Vitest: discriminated-union target parse; apply-result enum; run lifecycle.

### PE-2 · Constants + proposal/run helpers — 2h <!-- ✅ IMPLEMENTED -->
`constants/package-edit.ts`; `helpers/package-edit.ts` (SK builders, run CRUD w/
409-guard, staleness, queue enqueue). `runProposeEdits` engine reusing
`buildPackageInventory` + validate-substring. Tests mirror compliance engine.

### PE-3 · Handlers — 4h <!-- ✅ IMPLEMENTED -->
`chat.ts` (intent routing), `propose-worker.ts` (SQS), `get-run.ts` (poll +
crash-recovery), `apply-edits.ts` (guarded per-target, doc + form, snapshot each).
Tests: 400/404/409, tool-loop parse, **guarded apply skip-on-stale for both doc
and form targets**, worker markProposed/markFailed.

### PE-4 · CDK — 2h <!-- ✅ IMPLEMENTED -->
`package-edit.routes.ts` + register domain (index-aligned in `domainStackNames`);
`packageEditQueue` + DLQ + `PackageEditWorker` + log group; env vars in `commonEnv`.

### PE-5 · Frontend — package-edit feature — 5h <!-- ✅ IMPLEMENTED -->
Hooks (chat, poll, apply), `PackageEditPanel`, `ProposalRunView`, `ProposalDiffCard`
(reuse `VersionDiffView`), `ApplyResultReport`. Mount in `OpportunityView` next to
the compliance panel. RTL tests: poll skeleton, diff render, per-target report.

### PE-6 · Inline "Edit with AI" on finding cards — 2h <!-- ✅ IMPLEMENTED -->
`seedInstructionFromFinding`; add the button + inline composer + inline
`ProposalRunView` to `FindingCard.tsx` (Full Review findings only). Tests: seed
text, button hidden in `readOnly`.

### PE-7 · Unified review+edit chat — 3h <!-- ✅ IMPLEMENTED -->
Add the `propose_edits` capability on the **package-edit chat endpoint**
(`proposal:edit`), NOT by widening the compliance chat (`opportunity:read`) — see
§11. The frontend routes a message to the review chat or the edit chat by the
user's permission; response carries `intent` + `runId`. UI renders finding cards
(review) vs inline `ProposalRunView` (edit) per turn in one surface.

### PE-8 · Form version history UI — 2h <!-- ✅ IMPLEMENTED -->
Version list + revert in the form editor, reusing the document version-history UI.

---

## 15. Acceptance Criteria Checklist <!-- ✅ IMPLEMENTED -->

- [ ] Ask a compliance question in the unified chat → review answer (no run created).
- [ ] Ask "make the total $2.4M everywhere" → a proposal run starts async; UI polls; proposals list every affected RFP doc **and** form field.
- [ ] Diff preview shows before→after per target; re-validates freshness when opened.
- [ ] Apply → per-target report ("N of M applied; K skipped-stale").
- [ ] Each applied **document** has a new version snapshot (existing history).
- [ ] Each applied **form** has a new `RequiredFormVersion` snapshot and is revertible.
- [ ] A target changed since proposal → `skipped-stale`, not overwritten.
- [ ] A value appearing 3× in one document produces 3 separate proposals, each individually reviewable/skippable; an ambiguous `before` (>1 match at apply) is `skipped-stale`, never guessed.
- [ ] "Edit with AI" on a finding card opens an inline composer pre-seeded from the finding; proposals + apply happen in-card.
- [ ] Chat turn never exceeds 29s (scan is async; verify on a large package).
- [ ] Export a document + a form after edits → new values present, **no** stray markup.
- [ ] `readOnly` chat findings do **not** show "Edit with AI".
- [ ] Manual form field save also creates a version (history parity).
- [ ] Audit log records every applied edit (before→after) + run start/finish.

---

## 16. Summary of New Files <!-- ✅ IMPLEMENTED -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/package-edit.ts` | Edit target/proposal/run/chat/apply schemas | ✅ |
| `packages/core/src/schemas/required-form-version.ts` | Form snapshot schema (history parity) | ✅ |
| `apps/functions/src/constants/package-edit.ts` | PKs + tuning | ✅ |
| `apps/functions/src/constants/required-form-version.ts` | Form-version PK + keep-count | ✅ |
| `apps/functions/src/helpers/package-edit.ts` | SK builders, run CRUD (409-guard), staleness | ✅ |
| `apps/functions/src/helpers/package-edit-queue.ts` | `enqueuePackageEditProposal` | ✅ |
| `apps/functions/src/helpers/package-edit-engine.ts` | `runProposeEdits` (scan + before-validation) | ✅ |
| `apps/functions/src/helpers/package-edit-apply.ts` | Guarded per-target apply loop | ✅ |
| `apps/functions/src/helpers/package-edit-audit.ts` | Non-blocking audit entries | ✅ |
| `apps/functions/src/helpers/required-form-version.ts` | Snapshot/list/get/revert form versions | ✅ |
| `apps/functions/src/handlers/package-edit/chat.ts` | Sync intent-routing chat (`proposal:edit`) | ✅ |
| `apps/functions/src/handlers/package-edit/propose-worker.ts` | Async proposal scan (SQS) | ✅ |
| `apps/functions/src/handlers/package-edit/get-run.ts` | Poll run + proposals + staleness | ✅ |
| `apps/functions/src/handlers/package-edit/apply-edits.ts` | Guarded per-target apply | ✅ |
| `apps/functions/src/handlers/required-forms/{list-form-versions,revert-form-version}.ts` | Form version history + revert | ✅ |
| `packages/infra/api/routes/package-edit.routes.ts` | Routes | ✅ |
| `apps/web/features/package-edit/**` | Panel, run view, diff card, result report, inline editor, form history, hooks, seed/diff libs | ✅ |
| **MODIFIED** `apps/functions/src/handlers/required-forms/{save-form-fields,update-form-field}.ts` | Snapshot before write | ✅ |
| **MODIFIED** `packages/core/src/schemas/audit.ts` | Package-edit + form-version audit actions/resources | ✅ |
| **MODIFIED** `packages/infra/api/routes/required-forms.routes.ts` | Form-version routes (versions, revert-version) | ✅ |
| **MODIFIED** `apps/web/features/compliance-review/components/FindingCard.tsx` | Inline "Edit with AI" (via package-edit barrel) | ✅ |
| **UNIFIED CHAT (§11)** — implemented as the **separate** `package-edit/chat.ts` endpoint (`proposal:edit`), NOT by widening `compliance-review/chat.ts` (`opportunity:read`), per §11's own guidance | `propose_edits` tool + intent routing | ✅ |
| **MODIFIED** `packages/infra/api/api-orchestrator-stack.ts` | Queue + DLQ + worker + log group + domain register | ✅ |
| **MODIFIED** `apps/web/components/opportunities/OpportunityView.tsx` | Mount package-edit panel + nav item | ✅ |

---

## 17. Open Items to Decide at Implementation Time <!-- ✅ IMPLEMENTED -->

1. **§11 permission model (RESOLVED — `proposal:edit`).** Edit endpoints gate on
   `proposal:edit` (ADMIN+EDITOR only); `opportunity:edit` is an accepted
   equivalent. Review stays on the `opportunity:read` compliance chat; editing is a
   separate `proposal:edit` package-edit endpoint. One chat surface, two
   permission-scoped endpoints; read-only users never see the edit affordance.
2. **Unified vs separate history:** does the unified chat reuse compliance chat
   history, or does package-edit keep its own? (Affects whether `get-history.ts` +
   `PACKAGE_EDIT_CHAT_PK` are needed.)
3. **"Apply directly" fast path** for trivial single-string replacements (skip the
   diff)? Deferred — default is always propose→confirm.
4. **Multi-occurrence (RESOLVED — one edit per occurrence).** The worker emits a
   separate `ProposedEdit` per occurrence with a unique `before` (context-padded)
   + anchor. Apply refuses to edit an ambiguous (>1 match) `before` and reports it
   `skipped-stale` rather than guessing. Implementation detail to nail down: how
   much surrounding context the worker adds to guarantee `before` uniqueness.
5. **Form snapshot retention:** keep-N + TTL like the compliance runs, to bound
   storage of large compressed field arrays.
```
