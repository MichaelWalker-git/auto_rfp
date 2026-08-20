# Full Package Coverage — Implementation Plan <!-- 🚧 IN PROGRESS -->

> **Status (2026-08-13):** Phases 1, 2, and 3 IMPLEMENTED — code + co-located
> tests written and passing; core/functions/infra typecheck clean; web source
> typecheck clean (pre-existing unrelated test-matcher + WinRateCard errors
> aside). Not yet deployed. Both open build-time decisions are now RESOLVED:
>
> - **XLSX fidelity — VERIFIED + fixed.** Tested against a real Dev questionnaire
>   (`Attachment-A`, `A1:Z989`, 1658 styled cells / 9 merges / 100 filled values).
>   A SheetJS (`xlsx`) read→write round-trip DROPPED the 1558 empty-but-styled
>   cells, destroying the form's borders/shading. Switched `writeQuestionnaireCells`
>   to **exceljs** (same library the manual `QuestionnaireViewer` save already uses
>   for this exact reason), which round-trips the file losslessly (all 1658 cells +
>   9 merges + styling intact, ~same byte size). The staleness guard reads
>   exceljs `.text`, which matched SheetJS `w ?? v` on all 100 filled cells, so the
>   guard stays consistent with the proposal's `before`.
> - **Apply/revert Lambda IAM — CONFIRMED sufficient.** `commonLambdaRole` already
>   has `documentsBucket.grantReadWrite` (api-orchestrator-stack.ts:286), which
>   covers get/put/delete and the copy's get-source+put-dest; there is no separate
>   `s3:CopyObject` action.

> Goal: AI compliance **review** AND AI **edit** across the ENTIRE package —
> every RFP document, every required-form type, and every questionnaire type.
>
> This doc closes the remaining coverage gaps in the existing Cross-Package AI
> Editing ("Mass Edit") + Compliance Review features. It is grounded against the
> current code (2026-08-13) and follows the developer implementation workflow
> (core → constants/helpers → handlers → CDK → frontend), with co-located tests
> at every layer.

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Feature** | Full-coverage AI review + edit across all package content types |
| **Branch** | `feature/ai-mass-editing` (continues the existing work) |
| **Depends on** | Existing package-edit + compliance-review engines |
| **New entity** | `QuestionnaireVersion` (snapshot of an XLSX questionnaire file, revertible) |
| **Deploy order** | core → functions → web |

### The three phases

| Phase | Gap closed | Size | Deploy |
|---|---|---|---|
| **1** | Consistency cross-check doesn't scan form fields (R1) | Small | functions |
| **3** | Form edits match field *values* only, not *labels* (E2) | Small | functions |
| **2** | XLSX questionnaires cannot be edited at all (E1/E3) | Large | core + functions + web |

Phases are independently shippable. Recommended order: **1 → 3 → 2** (do the two
small, low-risk review/edit fixes first; then the large XLSX-editor build).

### Coverage matrix (target end-state)

| Content type | Review | Edit |
|---|---|---|
| A. RFP document (HTML) | ✅ today | ✅ today |
| B. HTML questionnaire | ✅ today | ✅ today |
| C. XLSX questionnaire (file-based) | ✅ today (incl. consistency) | ❌ → ✅ **Phase 2** |
| D/E/F. Required forms (PDF/XLSX/DOCX) | ✅ today; consistency ❌ → ✅ **Phase 1** | ✅ today; labels ❌ → ✅ **Phase 3** |

---

## 2. Architecture Overview <!-- ✅ IMPLEMENTED -->

The existing propose-then-confirm flow is unchanged; Phase 2 adds a third edit
target kind that threads through the same pipeline:

```
                       ┌─────────────── chat (Haiku, <29s) ── routes intent
                       │
  EDIT instruction ────┤
                       │
                       └──► SQS ──► propose-worker (Sonnet, 15min)
                                        │
                                        ▼
                            runProposeEdits → expandReplacements
                              scans:  documents (HTML)         → RFP_DOCUMENT edits
                                      form fields (values+labels) → FORM edits
                                      questionnaire cells [NEW]  → QUESTIONNAIRE edits
                                        │
                                        ▼  proposals persisted on the run
                            user confirms → POST /package-edit/apply (sync, LLM-free)
                                        │
                              applyOneEdit routes by target.kind:
                                RFP_DOCUMENT → applyHtmlEdit + updateRFPDocumentWithContent
                                FORM         → snapshotFormFields + updateRequiredForm
                                QUESTIONNAIRE→ snapshotQuestionnaire + writeQuestionnaireCells [NEW]
```

| Decision | Choice | Why |
|---|---|---|
| Questionnaire edit granularity | **Per-cell** (`{sheetName,row,col,ref}`) | Matches the review anchor + the editor's `data-highlight-cell` coords; guarded apply re-verifies the single cell |
| XLSX write | Read S3 → **exceljs** load → set `cell.value` by A1 ref → `writeBuffer` → S3 (same `fileKey`) | **exceljs, NOT SheetJS** — SheetJS `XLSX.write` drops empty-but-styled cells and destroys the form's styling (verified on a real questionnaire); exceljs preserves it. Matches the manual `QuestionnaireViewer` save. No client involvement. |
| Versioning | **Dedicated `QuestionnaireVersion` snapshot** | Consistent with forms/docs; revertible; mirrors `RequiredFormVersion` exactly |
| Staleness guard | Re-read the cell; current value must equal `before` | Same "skip + report, don't clobber" philosophy as documents/forms |

---

## 3. Phase 1 — Consistency cross-check over form fields <!-- ✅ IMPLEMENTED -->

**Gap (R1):** `computeConsistencyFindings` scans `inventory.documents` (HTML +
XLSX questionnaire cells) but never `inventory.forms[].fields[]`. A company-name
or identifier inconsistency inside a form field is only caught by model sampling,
not the deterministic guarantee layer.

**File:** `apps/functions/src/helpers/compliance-review-consistency.ts` (edit).

**Change:** treat each form as an additional "doc-like" text source in the same
two passes (name grouping + identifier check), anchoring findings to the field.

1. After building `texts` for documents, also build a per-form joined text:
   ```typescript
   // Forms are field-based; join each field's "label: value" with the same
   // phrase-breaking delimiter used for questionnaire cells so values in
   // separate fields don't glue into false name phrases.
   const formTexts = new Map<string, { text: string; fields: FormFieldInventory[] }>();
   for (const form of inventory.forms) {
     const joined = form.fields
       .map((f) => `${f.label ?? ''}: ${f.value ?? ''}`.trim())
       .filter(Boolean)
       .join(' | ');
     formTexts.set(form.formId, { text: joined, fields: form.fields });
   }
   ```
2. Include form phrases in the candidate list fed to `groupNameVariants`
   (`phrasesPerDoc` gains the form entries), so the ONE model call still runs once
   over the whole candidate set — no extra model calls.
3. When a form's text contains a grouped variant, emit a finding anchored to the
   FIELD whose value contains the variant (so the UI can navigate to it):
   ```typescript
   findings.push({
     findingId: `consistency-name-form-${form.formId}-${field.fieldId}`,
     targetKind: 'XLSX_FORM', // or PDF_FORM — reuse form target kind from inventory
     documentId: form.formId,
     documentTitle: form.name,
     anchor: { kind: 'field', fieldId: field.fieldId },
     issueType: 'INCONSISTENCY',
     severity: 'major',
     snippet: variant,
     title: `Company name inconsistent in "${form.name}"`,
     description: `The field "${field.label}" uses "${variant}" for the company name, which differs from the standard "${canonNorm}" used elsewhere in the package.`,
     suggestion: `Replace "${variant}" with "${canonNorm}".`,
   });
   ```
4. Identifier check: run `identifierMissingNearLabel(form text, label, value)` per
   form the same way it runs per doc; anchor to the field whose label matches.

**Tests** (`compliance-review-consistency.test.ts`, extend):
- Flags a form field whose value is a grouped name variant (anchored to fieldId).
- Does NOT flag a form field already using the canonical name.
- Flags a form with an identifier label present but the canonical value absent.
- Best-effort: a model failure yields no name findings, never throws (existing).

**No core/schema/CDK change.** `targetKind` values (`XLSX_FORM`/`PDF_FORM`) and
the `field` anchor already exist in `RawFinding` + `FindingAnchorSchema`.

---

## 4. Phase 3 — Form field-LABEL matching in edits <!-- ✅ IMPLEMENTED -->

**Gap (E2):** the edit engine's literal pass matches `find` only against
`field.value`; a value that lives in a field's LABEL isn't targeted. (The regex
pass already checks `label + value` via `findRegexInFieldValue`; only the literal
pass is value-only.)

**File:** `apps/functions/src/helpers/package-edit-engine.ts` (edit,
`expandReplacements` literal form pass, ~line 213).

**Decision to confirm during build:** forms are edited by writing `field.value`
(via `updateRequiredForm`) — a form's LABEL is not a writable target. So "match
the label" means: **if the find token appears in the label, still propose the
value edit** only when the token also appears in the value; a token that appears
*only* in the label has no writable target and should be reported as unmatched
(or skipped), not silently dropped. The safe, useful change is:

```typescript
for (const form of inventory.forms) {
  for (const field of form.fields) {
    const value = field.value ?? '';
    const inValue = value.includes(find);
    // Label is context only — used to disambiguate, never written. We only
    // propose when the find token is actually in the writable value.
    if (!inValue) continue;
    hits++;
    pushForm(form, field, value, replaceInFieldValue(value, find, replace), note);
  }
}
```

If the intended semantic is broader (e.g. "the label says 'Old Co Name' and the
value is blank — fill it"), that's a *fill*, not a *replace*, and is out of scope
for the literal find/replace pass. **Recommendation:** keep Phase 3 to the
regex-parity fix — the regex pass already reads the label as anchor context,
which is the real E2 fix. Concretely, Phase 3 = confirm/add tests that a
`findRegex` + `near` where the anchor is in the label produces the value edit
(this is the phone-field case already fixed), and document that label-only values
are not writable. **Net Phase 3 may be tests + a doc note only** — verify against
a live form before adding code.

**Tests** (`package-edit-engine.test.ts` or occurrences test): a form field whose
label contains the `near` anchor and whose value matches the regex yields one
FORM proposal.

---

## 5. Phase 2 — XLSX questionnaire editing <!-- ✅ IMPLEMENTED -->

The core build. XLSX questionnaires (`documentType QUESTIONNAIRE`, file-based,
`fileKey`, no `htmlContentKey`) have content only in the S3 `.xlsx`. Today the
edit engine skips them (`if (!doc.htmlContentKey) continue`) and there is no
`QUESTIONNAIRE` target or backend cell writer. Four sub-parts.

### 5.1 Core schema — new edit target + versioning entity <!-- ✅ IMPLEMENTED -->

**File:** `packages/core/src/schemas/package-edit.ts` (edit `EditTargetSchema`).

Add a third member to the discriminated union:

```typescript
z.object({
  kind: z.literal('QUESTIONNAIRE'),
  documentId: z.string(),
  documentTitle: z.string().optional(),
  sheetName: z.string(),  // the sheet the cell belongs to (first sheet today)
  row: z.number().int().min(0),   // 0-based SheetJS row (== editor coords)
  col: z.number().int().min(0),   // 0-based SheetJS col
  ref: z.string(),                // A1 ref (e.g. "C7") for display + write
}),
```

`ProposedEditSchema`, `EditApplyResultSchema` (already has optional
`newVersionNumber`), and the run schema need no structural change — a
`QUESTIONNAIRE` edit is just another `ProposedEdit` whose `before`/`after` are the
cell's current/next value.

**File:** `packages/core/src/schemas/questionnaire-version.ts` (NEW) — mirror
`required-form-version.ts`, but snapshot the FILE (S3 key), not a fields array:

```typescript
import { z } from 'zod';

export const QuestionnaireVersionSourceSchema = z.enum([
  'MANUAL', 'AI_MASS_EDIT', 'SYSTEM',
]);
export type QuestionnaireVersionSource = z.infer<typeof QuestionnaireVersionSourceSchema>;

export const QuestionnaireVersionSchema = z.object({
  versionId: z.string(),
  documentId: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  versionNumber: z.number().int().min(1),
  // The snapshot is the .xlsx file as it was BEFORE this version's write, stored
  // as its own S3 object (versioned copies live under a versions/ prefix).
  snapshotFileKey: z.string(),
  source: QuestionnaireVersionSourceSchema.default('MANUAL'),
  changeNote: z.string().max(500).optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
  createdAt: z.string(),
});
export type QuestionnaireVersion = z.infer<typeof QuestionnaireVersionSchema>;

export const QuestionnaireVersionListResponseSchema = z.object({
  versions: z.array(QuestionnaireVersionSchema),
  count: z.number(),
});
export type QuestionnaireVersionListResponse = z.infer<typeof QuestionnaireVersionListResponseSchema>;

export const RevertQuestionnaireVersionRequestSchema = z.object({
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  targetVersion: z.number().int().min(1),
  changeNote: z.string().max(500).optional(),
});
export type RevertQuestionnaireVersionRequest = z.infer<typeof RevertQuestionnaireVersionRequestSchema>;
```

Add `export * from './questionnaire-version';` to
`packages/core/src/schemas/index.ts`. Rebuild core before dependent typechecks.

> **Note:** the snapshot stores an S3 key (not inline bytes) because an .xlsx can
> be MBs — far over the DynamoDB item budget. This differs from
> `RequiredFormVersion` (which gzips a fields array); questionnaires have no
> fields array, only the file.

### 5.2 Backend — XLSX cell writer + versioning helpers <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/questionnaire-edit.ts` (NEW) — the cell
writer, mirroring `fillXlsxForm`'s S3-read → set-cell → `XLSX.write` → S3-write:

```typescript
export interface QuestionnaireCellWrite {
  ref: string;      // A1 ref
  sheetName: string;
  before: string;   // guard: current cell value must equal this
  after: string;
}
export interface CellWriteResult { ref: string; status: 'applied' | 'skipped-stale'; }

/**
 * Guarded write of one or more cells back into the questionnaire's .xlsx in S3.
 * Reads the workbook, and for each write re-verifies the cell's CURRENT value
 * equals `before` (formatted `w` else raw `v`, matching the reader) — mismatch →
 * skipped-stale, never clobbered. Applied cells set `sheet[ref] = {t:'s', v:after}`.
 * Writes the buffer back to the SAME fileKey. Returns per-cell results.
 */
export const writeQuestionnaireCells = async (args: {
  fileKey: string;
  writes: QuestionnaireCellWrite[];
}): Promise<{ results: CellWriteResult[]; wroteAny: boolean }> => { /* … */ };
```

Key details (grounded in `compliance-review-xlsx.ts` + `xlsx-form-filler.ts`):
- Read: `XLSX.read(bytes, {type:'array'})`; resolve the sheet by `sheetName`
  (fall back to first sheet if absent, as the editor only renders sheet 0).
- Current value read must match the reader exactly: `cell.w ?? cell.v` → String.
- Write only cells that pass the guard; `XLSX.write(workbook, {type:'array', bookType:'xlsx'})`.
- Upload via `uploadToS3(bucket, fileKey, Buffer.from(out), XLSX_MIME)`.
- **Fidelity:** do NOT drop sheets (unlike `fillXlsxForm`) — a questionnaire's
  other sheets/instructions must survive. Only mutate the targeted cells.

**File:** `apps/functions/src/helpers/questionnaire-version.ts` (NEW) — mirror
`required-form-version.ts` (SK builders, list/get, snapshot, revert, prune), but:
- PK constant `QUESTIONNAIRE_VERSION_PK = 'QUESTIONNAIRE_VERSION'` in
  `apps/functions/src/constants/questionnaire-version.ts` (+ `KEEP_COUNT`).
- SK: `${orgId}#${projectId}#${oppId}#${documentId}#${paddedVersion}`.
- `snapshotQuestionnaire({ orgId, projectId, oppId, documentId, currentFileKey, source, userId })`:
  copy the current `.xlsx` to a version key
  (`questionnaire-versions/${documentId}/v${n}.xlsx`) via an S3 server-side copy,
  then `createItem` the `QuestionnaireVersion` row pointing at `snapshotFileKey`.
  Prune to newest N (delete both the row AND its S3 object).
- `revertQuestionnaireToVersion(...)`: snapshot current (source SYSTEM), then copy
  the target version's `snapshotFileKey` back onto the live `fileKey`.

### 5.3 Backend — engine proposes questionnaire cell edits <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/package-edit-engine.ts` (edit
`expandReplacements`).

The inventory already carries `doc.questionnaireCells` (built by
`buildPackageInventory`). Add a questionnaire pass alongside the doc + form passes,
for BOTH the literal and regex branches. A `pushQuestionnaire` helper mirrors
`pushDoc`/`pushForm`:

```typescript
const pushQuestionnaire = (
  doc: DocumentInventory,
  cell: QuestionnaireCell,
  before: string,
  after: string,
  note: string,
) =>
  pushEdit(
    {
      editId: uuidv4(),
      target: {
        kind: 'QUESTIONNAIRE',
        documentId: doc.documentId,
        documentTitle: doc.title,
        sheetName: doc.questionnaireCells!.sheetName,
        row: cell.row, col: cell.col, ref: cell.ref,
      },
      before, after, rationale: note, advisoryOnly: false,
    },
    `q:${doc.documentId}:${cell.ref}`, // dedup per cell
  );
```

Literal pass — scan each questionnaire cell value:
```typescript
for (const doc of inventory.documents) {
  const q = doc.questionnaireCells;
  if (!q) continue;
  for (const cell of q.cells) {
    if (!cell.value.includes(find)) continue;
    hits++;
    pushQuestionnaire(doc, cell, cell.value, replaceInFieldValue(cell.value, find, replace), note);
  }
}
```

Regex pass — reuse `findRegexInFieldValue(cell.value, re, replace, near, /*label*/ undefined)`;
anchor context for a cell is naturally weaker than a form label, so treat the
cell's value as the haystack (optionally also the adjacent label cell — see open
decision). Keep the conservative `if (r.near && !res.anchored) continue`.

> The engine's `before`/`after` for a cell are the WHOLE cell value (not a
> context-unique substring like documents) — a cell is an atomic unit, so the
> apply guard compares the full value, exactly like a form field.

### 5.4 Backend — apply routes questionnaire edits <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/package-edit-apply.ts` (edit).

Add `applyQuestionnaireEdit` and route it in `applyOneEdit`:

```typescript
const applyQuestionnaireEdit = async (edit, ctx): Promise<EditApplyResult> => {
  if (edit.target.kind !== 'QUESTIONNAIRE') return { editId: edit.editId, status: 'failed', message: 'Not a questionnaire target' };
  const { documentId, sheetName, ref } = edit.target;

  const doc = await getRFPDocument(ctx.projectId, ctx.oppId, documentId);
  if (!doc || !doc.fileKey) return { editId: edit.editId, status: 'skipped-stale', message: 'Questionnaire not found or has no file' };

  // History parity: snapshot the current .xlsx BEFORE the write (best-effort).
  let newVersionNumber: number | undefined;
  try {
    newVersionNumber = await snapshotQuestionnaire({
      orgId: ctx.orgId, projectId: ctx.projectId, oppId: ctx.oppId,
      documentId, currentFileKey: doc.fileKey, source: 'AI_MASS_EDIT', userId: ctx.userId,
    });
  } catch (e) { console.warn('[package-edit-apply] questionnaire snapshot failed (continuing):', (e as Error)?.message); }

  const { results } = await writeQuestionnaireCells({
    fileKey: doc.fileKey,
    writes: [{ ref, sheetName, before: edit.before, after: edit.after }],
  });
  const cell = results[0];
  if (!cell || cell.status === 'skipped-stale') {
    return { editId: edit.editId, status: 'skipped-stale', message: 'Cell value changed since proposed' };
  }
  return { editId: edit.editId, status: 'applied', newVersionNumber };
};
```

Update `applyOneEdit`'s dispatch to a 3-way switch on `edit.target.kind`
(`RFP_DOCUMENT` / `FORM` / `QUESTIONNAIRE`).

> **Batching note:** applying N cell edits to the same questionnaire currently
> means N read-modify-write round-trips (one per `applyOneEdit`). Acceptable for
> Stage 1 (packages have few questionnaires with few targeted cells). If it
> becomes hot, group `QUESTIONNAIRE` edits by `documentId` in `applyEdits` and
> pass all writes to a single `writeQuestionnaireCells` call — note this as a
> follow-up, don't build it now.

### 5.5 Backend — version history handlers <!-- ✅ IMPLEMENTED -->

Mirror the form-version handlers exactly:
- `apps/functions/src/handlers/questionnaire/list-questionnaire-versions.ts`
  (GET, `document:read`) → `QuestionnaireVersionListResponseSchema`.
- `apps/functions/src/handlers/questionnaire/revert-questionnaire-version.ts`
  (POST, `document:edit`) → `revertQuestionnaireToVersion`, audit-logged.

Each: thin handler, `orgId` from query (`getOrgId`), destructured `safeParse`,
`apiResponse`, `withSentryLambda` + middy stack, explicit tests.

### 5.6 CDK — routes + IAM <!-- ✅ IMPLEMENTED -->

**File:** `packages/infra/api/routes/questionnaire.routes.ts` (NEW or extend an
existing rfp-documents/questionnaire domain if one exists — verify):
```typescript
{ method: 'GET',  path: 'versions',        entry: lambdaEntry('questionnaire/list-questionnaire-versions.ts') },
{ method: 'POST', path: 'revert-version',  entry: lambdaEntry('questionnaire/revert-questionnaire-version.ts') },
```
Register the domain in `api-orchestrator-stack.ts` (`allDomains` +
`domainStackNames`, same index). Each Lambda gets an explicit `logs.LogGroup`
(2-week non-prod / INFINITE prod). No NEW IAM — the shared Lambda role already
has S3 read/write on the documents bucket and DynamoDB access. Confirm the
package-edit apply Lambda's role includes S3 `PutObject`/`CopyObject` on the
documents bucket (it reads today; writing questionnaires + version copies needs
write — verify and add to the shared role if missing).

### 5.7 Frontend — questionnaire version history tab <!-- ✅ IMPLEMENTED -->

Reuse the form version-history UI pattern (the "history is another tab in the
existing sidebar" decision). In the XLSX questionnaire editor
(`apps/web/components/rfp-documents/xlsx-questionnaire-editor-page.tsx` +
its sidebar), add a "History" tab that:
- `useSWR` GET `/questionnaire/versions?...` → `QuestionnaireVersionListResponse`.
- Renders versions newest-first with source/date/author (Skeleton while loading).
- A "Restore" action → POST `/questionnaire/revert-version`, then `mutate` the
  version list + reload the workbook.
- Reuse the existing `FormVersionHistory` component shape; types from
  `@auto-rfp/core`. `'use client'`, Shadcn UI, no raw HTML.

> The AI-proposed questionnaire edits themselves surface through the SAME unified
> chat + `ProposalRunView` inline diff cards already built — a `QUESTIONNAIRE`
> proposal renders as another diff card (documentTitle + cell ref + before→after).
> Verify `ProposalDiffCard` renders the new target kind's label (add a small
> branch: `target.kind === 'QUESTIONNAIRE'` → show `"<title> — cell <ref>"`).

---

## 6. Phase 4 — Coverage hardening (optional, iterative) <!-- ✅ IMPLEMENTED -->

Beyond the canonical name/identifier cross-check, review is model-sampled. Add
more deterministic cross-checks as real needs surface (e.g. cross-document
number/date consistency), each best-effort ([] on failure) in `augmentFindings`.
Not scheduled — prioritise by actual findings. No code now.

---

## 7. Permissions & RBAC <!-- ✅ IMPLEMENTED -->

No new permissions. Reuse:
- `proposal:edit` — apply (already covers questionnaire writes via the same handler).
- `document:read` — list questionnaire versions.
- `document:edit` — revert questionnaire version (matches form-version revert).

---

## 8. Testing <!-- ✅ IMPLEMENTED -->

| Layer | File | Cases |
|---|---|---|
| core | `questionnaire-version.test.ts` (vitest) | valid parse, source enum, versionNumber ≥1, changeNote cap, list envelope, revert request |
| core | `package-edit.test.ts` (extend) | `EditTargetSchema` parses a `QUESTIONNAIRE` target; rejects negative row/col |
| helper | `questionnaire-edit.test.ts` | applied write; skipped-stale on value mismatch; sheet fallback; untouched sheets preserved; S3 read/write mocked |
| helper | `questionnaire-version.test.ts` | snapshot copies file + writes row; prune deletes row + object; revert snapshots-then-restores |
| helper | `package-edit-engine.test.ts` (extend) | literal + regex passes emit `QUESTIONNAIRE` proposals from `questionnaireCells`; dedup per cell |
| helper | `package-edit-apply.test.ts` (extend) | `QUESTIONNAIRE` edit routes to writer + snapshots; stale cell skipped |
| helper | `compliance-review-consistency.test.ts` (extend) | form-field name variant flagged/anchored; identifier-in-form flagged (Phase 1) |
| handler | `list-questionnaire-versions.test.ts`, `revert-questionnaire-version.test.ts` | happy / 400 / 404, permission wiring |
| web | questionnaire history tab `__tests__` | renders versions (skeleton first), restore triggers mutate |

Mock AWS SDK + middy before imports; test exported functions, not middy handlers.

---

## 9. Summary of New / Changed Files <!-- ✅ IMPLEMENTED -->

| File | Change | Phase | Status |
|---|---|---|---|
| `packages/core/src/schemas/package-edit.ts` | +`QUESTIONNAIRE` edit target | 2 | ⏳ |
| `packages/core/src/schemas/questionnaire-version.ts` | NEW entity | 2 | ⏳ |
| `packages/core/src/schemas/index.ts` | export questionnaire-version | 2 | ⏳ |
| `apps/functions/src/constants/questionnaire-version.ts` | NEW (PK, keep-count) | 2 | ⏳ |
| `apps/functions/src/helpers/questionnaire-edit.ts` | NEW cell writer | 2 | ⏳ |
| `apps/functions/src/helpers/questionnaire-version.ts` | NEW snapshot/revert | 2 | ⏳ |
| `apps/functions/src/helpers/package-edit-engine.ts` | questionnaire pass | 2 | ⏳ |
| `apps/functions/src/helpers/package-edit-apply.ts` | `applyQuestionnaireEdit` + dispatch | 2 | ⏳ |
| `apps/functions/src/handlers/questionnaire/list-questionnaire-versions.ts` | NEW | 2 | ⏳ |
| `apps/functions/src/handlers/questionnaire/revert-questionnaire-version.ts` | NEW | 2 | ⏳ |
| `packages/infra/api/routes/questionnaire.routes.ts` | NEW routes + register | 2 | ⏳ |
| `apps/web/.../xlsx-questionnaire-editor-page.tsx` (+ history tab) | version tab | 2 | ⏳ |
| `apps/web/.../ProposalDiffCard.tsx` | render QUESTIONNAIRE label | 2 | ⏳ |
| `apps/functions/src/helpers/compliance-review-consistency.ts` | scan form fields | 1 | ⏳ |
| `apps/functions/src/helpers/package-edit-engine.ts` | (Phase 3 label/regex parity) | 3 | ⏳ |

---

## 10. Open decisions (resolve at build time) <!-- ✅ IMPLEMENTED -->

1. **Questionnaire cell anchor for regex `near`:** value-only, or also the
   adjacent label cell (same row, col-1)? Start value-only + conservative drop;
   widen if it misses real cases. (Verify on a live questionnaire.)
2. **XLSX round-trip fidelity:** confirm `XLSX.read` → mutate cells → `XLSX.write`
   preserves formulas/formatting/other sheets on a REAL questionnaire before
   trusting the writer in prod. Add a fidelity test with a fixture workbook.
3. **Phase 3 scope:** likely tests + doc-note only (regex pass already reads
   labels). Confirm against a live form; only add code if a real value-in-label
   replace case exists.
4. **Version snapshot storage prefix + TTL:** pick the S3 prefix
   (`questionnaire-versions/`) and whether version objects get a lifecycle rule.

---

## 11. Documented deviations from conventions

- **5-type entity pattern (schemas M1).** `PackageEditRun`, `QuestionnaireVersion`,
  and `RequiredFormVersion` intentionally do NOT follow the standard 5-type entity
  pattern (`CreateRequest`/`UpdateRequest`/`Item`/`DBItem`/`ListItem`), and their
  `DBItem` is an `& DBItem` alias in the helper rather than a schema in core. This
  is deliberate: they are run/version records with a lifecycle (not
  create/update/list CRUD entities), and they mirror the existing
  `ComplianceReviewRun` sibling they were modeled on. Keeping them consistent with
  that sibling was preferred over conforming to the CRUD pattern. Revisit only if
  the `ComplianceReviewRun` family is itself migrated.
- **Raw `<button>` in a few FE components (W3).** `FormVersionHistory` /
  `QuestionnaireVersionHistory` use raw buttons with explicit gray-scale (not
  Shadcn `Button` + theme tokens) because the form-editor sidebar pins a light
  surface in both themes; `FindingsStats` severity chips and `ProposalRunView`
  select-all are lightweight text/badge toggles. All carry `type="button"` +
  `aria-pressed`/`aria-expanded` + `disabled`. Left as-is to avoid visual
  regressions for a consistency-only change.
```
