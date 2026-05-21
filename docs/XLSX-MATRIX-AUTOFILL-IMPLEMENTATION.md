# XLSX Response Matrix Auto-Fill & Required-Forms Hardening — Implementation

> Implementation doc for the next required-forms iteration. All sections start `<!-- ⏳ PENDING -->`. Update badges as work lands.

---

## 1. Overview <!-- ⏳ PENDING -->

| | |
|---|---|
| Feature | XLSX response matrix auto-fill + required-forms hardening |
| Driver | VRC ask: complete Attachment-A style requirement matrices automatically; tighten roles; surface review state to users |
| Capability source | Existing `CompanyProfile.fields[]` entries with `category === 'CAPABILITY'` |
| Approval scope | Per individual `Question` (mirrors answer-approval pattern) |
| Form-to-proposal | Auto-attach when `RequiredForm.status === 'DONE'`, user can detach |
| Mark detection | Empty + `MANUAL_REQUIRED` on first render; user toggles `X` / `○` |
| Delivery | Single PR — `feature/matrix-autofill-required-forms` |
| Date | 2026-05-21 |

### What we're shipping

| # | Requirement | Where it lands |
|---|---|---|
| 1 | XLSX matrix auto-fill — Comments column populated from CompanyProfile CAPABILITY via Bedrock | `xlsx-form-parser.ts`, new `matrix-autofill.ts`, `detect-required-forms.ts` |
| 2 | "Review Required" banner on all matrix forms before submission | `RequiredFormsList.tsx`, new `ReviewRequiredBanner.tsx` |
| 3 | Separate forms from original docs in opportunity view | `app/.../opportunities/[oppId]/page.tsx` + new section |
| 4 | Filled forms attached to RFP proposal with marker | `generate-document-worker.ts`, list/editor UI |
| 5 | Block form delete for non-admin | `delete-required-form.ts` (RBAC tighten) |
| 6 | Editor role: full edit (already true) | verified, no change |
| 7 | Detect check-mark / circle responses | `xlsx-form-parser.ts`, `textract-forms.ts` |
| 8 | Fill checkmark with ASCII `X` (XLSX) / image stamp (PDF) | `XlsxFormEditor.tsx`, `PdfFormEditor.tsx`, `export-filled-form.ts` |
| 9 | Circle responses (resizable circle stamp on PDF, `○` on XLSX) | same as #8 |
| 10 | "Approve" marker on individual questions | new `approve-question.ts` handler + question UI |
| 11 | "Generating" marker on questionnaire file | new `QuestionFileStatusBadge.tsx` |

---

## 2. Architecture Overview <!-- ⏳ PENDING -->

```
┌────────────────────────────────────────────────────────────────────┐
│ Question pipeline (existing Step Function)                         │
│                                                                    │
│   detect-required-forms ─┬─> XLSX branch ─> parseXlsxForms (ext)   │
│                          │                    │                    │
│                          │                    └─> autofillMatrix-  │
│                          │                        Comments() ←──── │ CompanyProfile
│                          │                            (Bedrock)    │
│                          └─> PDF branch  ─> Textract FORMS         │
│                                              + mark detection      │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ writes RequiredForm rows
                                   ▼
                        ┌─────────────────────────┐
                        │ DynamoDB single table   │
                        └────────────┬────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
   list-required-forms      update-form-field      generate-document-worker
   (per-opportunity)        (admin/editor)         (auto-attach DONE forms)
              │
              ▼
   apps/web /opportunities/[oppId]
   ├── Required Forms section (new)
   │   ├── ReviewRequiredBanner
   │   ├── Attached/Detach toggle
   │   └── Delete (admin-only)
   ├── XlsxFormEditor (X / ○ toggle)
   └── PdfFormEditor (X / ○ stamp tool)
```

### Technology decisions

| Decision | Choice | Why |
|---|---|---|
| Capability mapping | Bedrock fuzzy match against existing `CompanyProfile` entries | No new schema; can iterate to a structured rule table later if needed |
| Capability UI | Existing CompanyProfile settings page | Avoid new surface area until usage signals demand it |
| Auto-fill scope | Comments column only; response columns stay `MANUAL_REQUIRED` | Never claim compliance without human review |
| Approval scope | Per `Question` (boolean `approvedAt`/`approvedBy`) | Mirrors `answer.approvedAt` pattern already in core |
| Form attach | Auto when `status === 'DONE'`, detachable | One less click for the common case |
| Mark default | Empty + `MANUAL_REQUIRED` | Same posture as response columns — no false claims |
| Mark rendering | PDF: SVG stamp · XLSX: literal `X` / `○` | Each format renders what it can carry natively |

---

## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->

### 3.1 `packages/core/src/schemas/required-form.ts` — extend

```ts
// New: per-field mark metadata
export const FieldMarkTypeSchema = z.enum(['TEXT', 'CHECKBOX', 'CIRCLE']);
export type FieldMarkType = z.infer<typeof FieldMarkTypeSchema>;

export const FieldMarkGeometrySchema = z.object({
  cx: z.number(), // 0..1, fraction of page width
  cy: z.number(), // 0..1, fraction of page height
  radius: z.number().min(0).max(0.5),
});
export type FieldMarkGeometry = z.infer<typeof FieldMarkGeometrySchema>;

// Extend DetectedFormFieldSchema with mark + matrix metadata
export const DetectedFormFieldSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  value: z.string().nullable().default(null),
  status: FormFieldStatusSchema.default('EMPTY'),
  confidence: z.number().min(0).max(1).nullable().default(null),
  profileFieldKey: z.string().nullable().default(null),
  manualReason: z.string().nullable().default(null),
  pageNumber: z.number().nullable().default(null),
  cellReference: z.string().nullable().default(null),
  boundingBox: z.object({
    top: z.number(), left: z.number(), width: z.number(), height: z.number(),
  }).nullable().default(null),

  // NEW
  markType: FieldMarkTypeSchema.default('TEXT'),
  markChar: z.string().nullable().default(null),       // 'X', 'O', '○', or null
  markGeometry: FieldMarkGeometrySchema.nullable().default(null),
  matrixCategory: z.string().nullable().default(null), // section header for matrix row
  matrixFeature: z.string().nullable().default(null),  // feature/requirement text
  matrixColumn: z.enum(['FULLY_MEETS','PARTIALLY_MEETS','CANNOT_MEET','COMMENTS','OTHER']).default('OTHER'),
});

// Extend RequiredFormItemSchema with proposal attachment
export const RequiredFormItemSchema = z.object({
  // ...existing fields
  attachedToProposal: z.boolean().default(false),
  attachedAt: z.string().nullable().default(null),
});

// Extend UpdateFormFieldDTOSchema with mark fields
export const UpdateFormFieldDTOSchema = z.object({
  formId: z.string().min(1),
  fieldId: z.string().min(1),
  value: z.string().nullable().optional(),
  label: z.string().optional(),
  status: FormFieldStatusSchema.optional(),
  boundingBox: z.object({...}).optional(),
  markType: FieldMarkTypeSchema.optional(),
  markChar: z.string().nullable().optional(),
  markGeometry: FieldMarkGeometrySchema.nullable().optional(),
  delete: z.boolean().optional(),
});

// Extend UpdateRequiredFormDTOSchema
export const UpdateRequiredFormDTOSchema = z.object({
  // ...existing fields
  attachedToProposal: z.boolean().optional(),
  attachedAt: z.string().nullable().optional(),
});
```

### 3.2 `packages/core/src/schemas/question.ts` — extend `QuestionItemSchema`

```ts
export const QuestionItemSchema = z.object({
  // ...existing fields
  approvedBy: z.string().optional(),
  approvedByName: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
});

// NEW: ApproveQuestionDTO
export const ApproveQuestionDTOSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  questionFileId: z.string().min(1),
  questionId: z.string().min(1),
});
export type ApproveQuestionDTO = z.infer<typeof ApproveQuestionDTOSchema>;
```

### 3.3 No schema change needed for `QuestionFile`

Existing statuses (`UPLOADED`, `PROCESSING`, `TEXTRACT_RUNNING`, `TEXT_READY`, `PROCESSED`, `FAILED`) cover the "generating" badge. The frontend derives the badge from these.

### 3.4 Build order

```bash
cd packages/core && pnpm build
cd apps/functions && pnpm tsc --noEmit
cd apps/web && npx tsc --noEmit
```

---

## 4. DynamoDB Design <!-- ⏳ PENDING -->

No new PKs. Both new pieces of state ride existing entities:

| Entity | PK | SK | New attributes |
|---|---|---|---|
| `RequiredForm` | `PK.REQUIRED_FORM` | existing | `attachedToProposal`, `attachedAt`, plus per-field `markType`, `markChar`, `markGeometry`, `matrixCategory`, `matrixFeature`, `matrixColumn` |
| `Question` | `PK.QUESTION` | existing | `approvedBy`, `approvedByName`, `approvedAt` |

No GSI changes. No TTL changes.

---

## 5. Backend — Helpers <!-- ⏳ PENDING -->

### 5.1 `apps/functions/src/helpers/xlsx-form-parser.ts` — extend (don't rewrite)

Add to existing module:

- **Section-header detection** for `matrixCategory`: scan rows above the matrix header row. If a row has one non-empty cell that's longer than 4 chars and doesn't match `MATRIX_HEADER_PATTERNS`, treat it as the section title for the matrix that follows.
- **Mark-type detection** per column:
  ```ts
  const isCheckboxColumn = (header: string, sampleValues: string[]) =>
    /^(yes|no|✓|☐|☑|☒|check)$/i.test(header.trim()) ||
    sampleValues.every(v => v === '' || /^[xXoO○✓☑]$/.test(v.trim()));

  const isCircleColumn = (header: string) =>
    /circle|encircle/i.test(header);
  ```
- **`matrixColumn`** classification: derive from header regex (`fully meets` → `FULLY_MEETS`, `partially meets` → `PARTIALLY_MEETS`, `cannot meet` / `does not meet` → `CANNOT_MEET`, comments-pattern → `COMMENTS`, else `OTHER`).
- **`matrixFeature`** = `featureText` already extracted on line 76.
- **`matrixCategory`** = nearest section header above the row (carry-forward across rows).

Field construction sets `markType`, `matrixColumn`, `matrixCategory`, `matrixFeature`. Comments column stays `EMPTY` (auto-fill happens in next helper). Response columns stay `MANUAL_REQUIRED`.

### 5.2 NEW: `apps/functions/src/helpers/matrix-autofill.ts`

```ts
import { invokeModel } from './bedrock-http-client';
import { requireEnv } from './env';
import { getCompanyProfile } from './company-profile';
import type { DetectedFormField } from '@auto-rfp/core';

const getModelId = () => requireEnv('BEDROCK_MODEL_ID');

type AutofillArgs = {
  orgId: string;
  fields: DetectedFormField[];
};

export const autofillMatrixComments = async ({
  orgId, fields,
}: AutofillArgs): Promise<DetectedFormField[]> => {
  const profile = await getCompanyProfile(orgId);
  const capabilities = (profile?.fields ?? []).filter(f => f.category === 'CAPABILITY');
  if (capabilities.length === 0) return fields;

  const targets = fields.filter(f =>
    f.matrixColumn === 'COMMENTS' && f.status === 'EMPTY' && f.matrixFeature
  );
  if (targets.length === 0) return fields;

  const prompt = buildMatrixAutofillPrompt({ capabilities, targets });
  const responseBody = await invokeModel(getModelId(), JSON.stringify(prompt));
  const responses = parseAutofillResponse(responseBody, targets);

  return fields.map(f => {
    const match = responses.get(f.fieldId);
    if (!match) return f;
    return {
      ...f,
      value: match.value,
      status: 'AUTO_FILLED',
      confidence: match.confidence,
    };
  });
};
```

Prompt instructs Bedrock to return JSON `{ fieldId, value, confidence }[]` with `value: null` for unmatched features. Confidence < 0.5 → field stays `EMPTY` so a user provides text.

Tests live in `matrix-autofill.test.ts` (mock Bedrock).

### 5.3 `apps/functions/src/handlers/question-pipeline/detect-required-forms.ts` — extend XLSX branch

After `parseXlsxForms` on line 211:

```ts
let fields = sheets[0]?.fields ?? [];
if (validFormType === 'XLSX_MATRIX') {
  fields = await autofillMatrixComments({ orgId, fields });
}
const total = fields.length;
const manual = fields.filter(f => f.status === 'MANUAL_REQUIRED').length;
const filled = fields.filter(f => f.status === 'AUTO_FILLED').length;
const autoFillPercentage = total > 0 ? Math.round((filled / total) * 100) : 0;

await updateRequiredForm({
  orgId, projectId, opportunityId, formId,
  patch: {
    fields,
    status: 'READY',
    totalFieldCount: total,
    manualFieldCount: manual,
    autoFillPercentage,
    reviewRequired: true,        // matrices always require review
  },
});
```

### 5.4 `apps/functions/src/helpers/textract-forms.ts:mapBlocksToFields` — extend

In the existing checkbox branch (lines 148-152), set:
```ts
markType: 'CHECKBOX',
markChar: selectionStatus === 'SELECTED' ? 'X' : null,
```

Add a circle-detection arm: if KEY label matches `/circle|encircle/i`, set `markType: 'CIRCLE'`, persist KEY bounding box as `markGeometry` (normalized 0..1).

### 5.5 `apps/functions/src/helpers/required-form.ts` — extend

If a `getRequiredForm` / `updateRequiredForm` helper exists, no change needed. If `attachedToProposal` requires a new helper:
```ts
export const setFormAttachedToProposal = async (args: {
  orgId: string; projectId: string; opportunityId: string; formId: string;
  attached: boolean;
}) => updateRequiredForm({
  ...args,
  patch: {
    attachedToProposal: args.attached,
    attachedAt: args.attached ? new Date().toISOString() : null,
  },
});
```

### 5.6 NEW: `apps/functions/src/helpers/question.ts` — `approveQuestion`

```ts
export const approveQuestion = async (args: {
  orgId: string; projectId: string; opportunityId: string;
  questionFileId: string; questionId: string;
  userId: string; userName: string;
}) => {
  // updateItem on PK=PK.QUESTION, SK=buildQuestionSk(...)
  return updateItem({
    pk: PK.QUESTION,
    sk: buildQuestionSk(args),
    patch: {
      approvedBy: args.userId,
      approvedByName: args.userName,
      approvedAt: new Date().toISOString(),
    },
  });
};
```

Where the actual SK builder lives depends on existing question helper — re-use it.

---

## 6. Backend — Lambda Handlers <!-- ⏳ PENDING -->

### 6.1 NEW: `apps/functions/src/handlers/required-forms/attach-form-to-proposal.ts`

```
POST /required-forms/{formId}/attach    → { attached: true }
DELETE /required-forms/{formId}/attach  → { attached: false }
Permission: document:edit
```

Thin handler — destructures `safeParse`, calls `setFormAttachedToProposal`, returns `apiResponse`.

> **Note**: forms with `status === 'DONE'` are auto-attached when DONE is set (see §6.4). This endpoint exists so users can detach (or re-attach) manually.

### 6.2 NEW: `apps/functions/src/handlers/questions/approve-question.ts`

```
POST /questions/{questionId}/approve
Body: { orgId, projectId, opportunityId, questionFileId }
Permission: document:edit
```

### 6.3 EXTEND: `apps/functions/src/handlers/required-forms/delete-required-form.ts`

Currently uses `requirePermission('document:delete')`. Tighten by adding an explicit role check inside `baseHandler`:

```ts
if (event.rbac.role !== 'ADMIN') {
  return apiResponse(403, { message: 'Only admins can delete required forms' });
}
```

Update the test file to assert EDITOR → 403.

### 6.4 EXTEND: `apps/functions/src/handlers/required-forms/save-form-fields.ts` (and `update-form-field.ts`)

When the patch sets `status: 'DONE'` on the form, also flip `attachedToProposal: true` and `attachedAt: now()` (only if currently false). This is the auto-attach trigger.

### 6.5 EXTEND: `generate-document-worker.ts` (`apps/functions/src/handlers/rfp-document/generate-document-worker.ts`)

When assembling the proposal package:
1. Query `listRequiredFormsByOpportunity({ orgId, projectId, opportunityId })`.
2. Filter `status === 'DONE' && attachedToProposal === true`.
3. For each, attach `filledFileKey` to the proposal output (as a separate file in the zip / package, named `<form.name>.<ext>`).
4. Add a "FORM" marker entry to the proposal manifest so downstream UI can render the badge.

The exact integration depends on the worker's current shape — locate the manifest assembly and append. Helper lives in `helpers/generate-document-worker.ts`.

---

## 7. Backend — Export Filled Forms <!-- ⏳ PENDING -->

### 7.1 EXTEND: `apps/functions/src/handlers/required-forms/export-filled-form.ts`

**XLSX path** — when writing the filled workbook:
- For fields where `markType === 'CHECKBOX'` and `markChar`, write the literal char (`'X'`) to `cellReference`.
- For fields where `markType === 'CIRCLE'` and `markChar`, write `'○'`.
- For text fields, existing path unchanged.

**PDF path** — using `pdf-lib`:
- For fields where `markType === 'CIRCLE'` and `markGeometry`, draw an SVG circle at the absolute coordinates (`cx * pageWidth`, `cy * pageHeight`, radius proportional).
- For fields where `markType === 'CHECKBOX'` and `markChar === 'X'`, draw a small `X` glyph at the field's bounding box center.
- For text fields, existing path unchanged.

Both formats write the result back to S3 at the form's `filledFileKey` and update the form record.

---

## 8. REST API Routes <!-- ⏳ PENDING -->

### 8.1 EXTEND: `packages/infra/api/routes/required-forms.routes.ts`

Add two routes:
```ts
{ method: 'POST',   path: '/required-forms/{formId}/attach', entry: lambdaEntry('required-forms/attach-form-to-proposal.ts'), permission: 'document:edit' },
{ method: 'DELETE', path: '/required-forms/{formId}/attach', entry: lambdaEntry('required-forms/attach-form-to-proposal.ts'), permission: 'document:edit' },
```

### 8.2 EXTEND: `packages/infra/api/routes/questions.routes.ts`

```ts
{ method: 'POST', path: '/questions/{questionId}/approve', entry: lambdaEntry('questions/approve-question.ts'), permission: 'document:edit' },
```

No new domain registration — both already exist in `api-orchestrator-stack.ts`.

### 8.3 Endpoint summary

| Method | Path | Handler | Permission | Notes |
|---|---|---|---|---|
| POST | `/required-forms/{formId}/attach` | attach-form-to-proposal | `document:edit` | Manual attach |
| DELETE | `/required-forms/{formId}/attach` | attach-form-to-proposal | `document:edit` | Manual detach |
| POST | `/questions/{questionId}/approve` | approve-question | `document:edit` | Per-question approval |
| DELETE | `/required-forms/{formId}` | delete-required-form | `document:delete` + `role===ADMIN` | RBAC tightened |

---

## 9. Frontend — Hooks & Components <!-- ⏳ PENDING -->

### 9.1 File structure additions

```
apps/web/features/required-forms/
├── components/
│   ├── RequiredFormsList.tsx            # NEW — section list, role-aware
│   ├── ReviewRequiredBanner.tsx         # NEW — banner on editor + list
│   ├── AttachToProposalToggle.tsx       # NEW — auto/manual attach toggle
│   ├── XlsxFormEditor.tsx               # EXTEND — X / ○ toggles
│   └── PdfFormEditor.tsx                # EXTEND — circle / X stamp tool
├── hooks/
│   ├── useAttachFormToProposal.ts       # NEW — POST/DELETE /attach
│   ├── useDeleteRequiredForm.ts         # NEW or existing — admin-only UI gate
│   └── (existing)
└── index.ts                             # add new exports

apps/web/features/questions/
├── components/
│   ├── QuestionApproveButton.tsx        # NEW — per-question approve
│   └── QuestionFileStatusBadge.tsx      # NEW — Generating / Needs approval / Approved / Failed
└── hooks/
    └── useApproveQuestion.ts            # NEW — POST /questions/{id}/approve
```

### 9.2 `RequiredFormsList.tsx`

- Pure presentation. Props: `forms: RequiredFormItem[]`, `role: UserRole`, `onAttach`, `onDetach`, `onDelete`.
- Renders one row per form. Row contains:
  - Name + form-type chip
  - `<ReviewRequiredBanner />` if `reviewRequired`
  - "In proposal" badge if `attachedToProposal`
  - `<AttachToProposalToggle />` (visible when `status === 'DONE'`)
  - Edit link
  - Delete button — **rendered only when `role === 'ADMIN'`**

### 9.3 `XlsxFormEditor.tsx` — extend

For each cell, branch on `field.markType`:
- `'CHECKBOX'` → render an `<XToggleButton>` that toggles `markChar` between `'X'` and `null`. Cell stays `MANUAL_REQUIRED` (banner-style hint) until user confirms.
- `'CIRCLE'` → same, with `'○'`.
- `'TEXT'` → existing input.

### 9.4 `PdfFormEditor.tsx` — extend

Existing canvas overlay supports drag/resize for text fields. Add a tool palette:
- "Stamp X" — clicking a field places an `<text>` SVG element with `markChar='X'`.
- "Stamp Circle" — clicking a field places a `<circle>` SVG element resizable via existing handles. Saves `markGeometry: { cx, cy, radius }` in normalized coordinates.

Persist via existing `update-form-field` (now accepts `markType`, `markChar`, `markGeometry` in DTO).

### 9.5 `QuestionFileStatusBadge.tsx`

Pure mapping:
```tsx
const map: Record<QuestionFileStatus, { label: string; tone: BadgeTone }> = {
  UPLOADED:           { label: 'Queued',     tone: 'muted'  },
  PROCESSING:         { label: 'Generating…', tone: 'info' },
  TEXTRACT_RUNNING:   { label: 'Generating…', tone: 'info' },
  TEXT_READY:         { label: 'Generating…', tone: 'info' },
  PROCESSED:          { label: 'Ready',      tone: 'success' },
  FAILED:             { label: 'Failed',     tone: 'destructive' },
  DELETED:            { label: 'Deleted',    tone: 'muted'  },
  CANCELLED:          { label: 'Cancelled',  tone: 'muted'  },
};
```

When `status === 'PROCESSED'` and any question in the file lacks `approvedAt`, an additional `Needs approval` chip is rendered next to the status badge. Both chips use Shadcn `<Badge>`.

### 9.6 `QuestionApproveButton.tsx`

Per-question button. Hidden when `question.approvedAt` is set (replaced with a small "Approved by X · 2026-05-21" inline label). Calls `useApproveQuestion(questionId)` which POSTs and revalidates the SWR key.

### 9.7 Opportunity page — separate Forms section

`apps/web/app/organizations/[orgId]/projects/[projectId]/opportunities/[oppId]/page.tsx`:
- Existing sections: Analysis, Solicitations, RFP Documents, Submission, Post-Award.
- Insert **Required Forms** as a new section between RFP Documents and Submission. Uses `useRequiredForms(opportunityId)` SWR hook + `<RequiredFormsList>`.

---

## 10. Permissions & RBAC <!-- ⏳ PENDING -->

No new permissions. Tightened gates only:

| Action | Permission | Additional gate |
|---|---|---|
| Delete required form | `document:delete` | `role === 'ADMIN'` |
| Attach/detach form to proposal | `document:edit` | none |
| Approve question | `document:edit` | none |
| Edit form field (incl. mark fields) | `document:edit` | none (EDITOR has it) |

---

## 11. CDK Stack Updates <!-- ⏳ PENDING -->

| Stack | Change |
|---|---|
| `api-orchestrator-stack.ts` | No domain additions (routes ride existing required-forms + questions domains) |
| `question-pipeline-step-function.ts` | No change — `detect-required-forms` Lambda already provisioned. Bedrock IAM already on shared role. |
| `database-stack.ts` | No change — new attributes ride existing items |
| Logs | New attach + approve Lambdas need explicit `logs.LogGroup` (2-week retention non-prod, INFINITE prod) |

---

## 12. Implementation Tickets <!-- ⏳ PENDING -->

> Single PR `feature/matrix-autofill-required-forms`. Tickets below are internal milestones — each lands as one or two commits.

### MA-1 · Core schemas (45 min) <!-- ⏳ PENDING -->
- Extend `RequiredFormItem`, `DetectedFormField`, `UpdateFormFieldDTO`, `UpdateRequiredFormDTO`
- Add `ApproveQuestionDTO`, extend `QuestionItem` with approval fields
- `pnpm --filter @auto-rfp/core build`
- AC: `tsc --noEmit` clean in core, functions, web

### MA-2 · XLSX parser — mark detection + matrix metadata (1 h) <!-- ⏳ PENDING -->
- Detect checkbox / circle columns
- Capture `matrixCategory` (section header carry-forward), `matrixFeature`, `matrixColumn`
- Add fixtures: matrix with checkbox column, matrix with circle column, matrix with multi-section header
- AC: parser produces correct field metadata for fixtures

### MA-3 · Matrix autofill helper (1 h) <!-- ⏳ PENDING -->
- New `helpers/matrix-autofill.ts` with `autofillMatrixComments`
- Wire into `detect-required-forms.ts` XLSX branch — only for `XLSX_MATRIX`
- Force `reviewRequired: true` on matrix forms
- Test with mocked Bedrock + sample CompanyProfile
- AC: with empty CapabilityCompanyProfile, fields untouched; with matching capabilities, comments populated as `AUTO_FILLED`

### MA-4 · Textract mark detection for PDFs (45 min) <!-- ⏳ PENDING -->
- Extend `mapBlocksToFields` to set `markType` / `markChar` / `markGeometry`
- Test with synthetic Textract block fixtures
- AC: SELECTED checkbox → `markChar: 'X'`; "circle the correct option" KEY → `markType: 'CIRCLE'`

### MA-5 · Backend RBAC + new endpoints (1 h) <!-- ⏳ PENDING -->
- Tighten `delete-required-form` to admin-only
- New `attach-form-to-proposal` handler (POST/DELETE)
- New `approve-question` handler (POST)
- Auto-attach trigger in `save-form-fields` / `update-form-field` when status flips to DONE
- Routes registered in `required-forms.routes.ts` and `questions.routes.ts`
- AC: handler tests pass; EDITOR → 403 on delete; ADMIN succeeds

### MA-6 · Generate-document-worker proposal attachment (1 h) <!-- ⏳ PENDING -->
- In worker assembly, query forms where `status === 'DONE' && attachedToProposal === true`
- Append filled file to proposal package and add manifest entry
- AC: end-to-end smoke test on dev — generate proposal includes filled form

### MA-7 · Export filled forms — checkbox / circle (1 h) <!-- ⏳ PENDING -->
- XLSX writer: write `markChar` literal into cell
- PDF writer: stamp `<circle>` / `X` glyph using `pdf-lib`
- AC: export produces a file containing the marks

### MA-8 · Frontend — required-forms section + components (2 h) <!-- ⏳ PENDING -->
- `RequiredFormsList`, `ReviewRequiredBanner`, `AttachToProposalToggle`
- Insert new section into opportunity page
- Hide delete button unless `role === 'ADMIN'`
- AC: forms section renders, role gating works, attach toggle calls API

### MA-9 · Frontend — XLSX / PDF editor mark UI (2 h) <!-- ⏳ PENDING -->
- `XToggleButton` in `XlsxFormEditor` for checkbox/circle cells
- Stamp tool palette in `PdfFormEditor`
- Persist via existing `update-form-field` (now carries `markType`/`markChar`/`markGeometry`)
- AC: toggling a checkbox cell writes `'X'` to the value and persists

### MA-10 · Frontend — questions approval + status badges (1 h) <!-- ⏳ PENDING -->
- `QuestionFileStatusBadge` rendered next to each questionnaire entry
- `QuestionApproveButton` per question; needs-approval chip when any question lacks `approvedAt`
- AC: badges reflect status changes; approve button hides after approval

### MA-11 · Tests + final verification (1 h) <!-- ⏳ PENDING -->
- All new handlers covered (happy path + 403 for non-admin delete + 400 validation)
- Parser fixtures
- Frontend snapshot tests for `RequiredFormsList` (admin vs editor) and `QuestionFileStatusBadge` (each status)
- AC: `pnpm test` green in functions, web, core

---

## 13. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

- [ ] An XLSX matrix with `Fully Meets / Partially Meets / Cannot Meet` columns is detected as `XLSX_MATRIX`
- [ ] Each (feature × column) cell becomes a field with `matrixColumn` set
- [ ] Comments column on matrix forms is auto-populated when CompanyProfile has matching CAPABILITY entries; otherwise `EMPTY`
- [ ] Response columns stay `MANUAL_REQUIRED` regardless of capability data
- [ ] All matrix forms have `reviewRequired: true` and show the "Review Required" banner
- [ ] Required-Forms section is visually separate from Solicitation Documents on the opportunity page
- [ ] Filled forms with `status === 'DONE'` are auto-attached to the next proposal generation
- [ ] User can detach a form from the proposal via UI
- [ ] EDITOR role cannot delete required forms (403); ADMIN can
- [ ] EDITOR role can save / add / edit / rename form fields (no regression)
- [ ] PDF checkbox fields render in the editor as `X`-toggle buttons
- [ ] PDF circle-response fields render in the editor as resizable circle stamps
- [ ] XLSX checkbox fields render in the editor as `X`-toggle buttons
- [ ] XLSX circle fields render with `○` toggle
- [ ] Exported XLSX contains the literal `X` / `○` characters in the right cells
- [ ] Exported PDF contains the SVG stamp at the correct coordinates
- [ ] Each question shows an "Approve" button when not approved
- [ ] Approved questions show "Approved by X · date" instead of the button
- [ ] QuestionFileStatusBadge shows "Generating…" while `PROCESSING`/`TEXTRACT_RUNNING`/`TEXT_READY`
- [ ] QuestionFileStatusBadge shows "Needs approval" when file is `PROCESSED` and any question lacks `approvedAt`

---

## 14. Summary of New Files <!-- ⏳ PENDING -->

| Path | Purpose | Status |
|---|---|---|
| `apps/functions/src/helpers/matrix-autofill.ts` | Bedrock-driven Comments auto-fill from CompanyProfile CAPABILITY | ⏳ |
| `apps/functions/src/helpers/matrix-autofill.test.ts` | Tests for above | ⏳ |
| `apps/functions/src/handlers/required-forms/attach-form-to-proposal.ts` | POST/DELETE /attach | ⏳ |
| `apps/functions/src/handlers/required-forms/attach-form-to-proposal.test.ts` | Tests | ⏳ |
| `apps/functions/src/handlers/questions/approve-question.ts` | POST /questions/{id}/approve | ⏳ |
| `apps/functions/src/handlers/questions/approve-question.test.ts` | Tests | ⏳ |
| `apps/web/features/required-forms/components/RequiredFormsList.tsx` | Required-forms section | ⏳ |
| `apps/web/features/required-forms/components/ReviewRequiredBanner.tsx` | Banner | ⏳ |
| `apps/web/features/required-forms/components/AttachToProposalToggle.tsx` | Attach/detach UI | ⏳ |
| `apps/web/features/required-forms/hooks/useAttachFormToProposal.ts` | SWR mutation | ⏳ |
| `apps/web/features/questions/components/QuestionApproveButton.tsx` | Per-question approve UI | ⏳ |
| `apps/web/features/questions/components/QuestionFileStatusBadge.tsx` | Status / needs-approval chip | ⏳ |
| `apps/web/features/questions/hooks/useApproveQuestion.ts` | SWR mutation | ⏳ |

### Modified files

| Path | Change | Status |
|---|---|---|
| `packages/core/src/schemas/required-form.ts` | New mark + matrix + attached fields | ⏳ |
| `packages/core/src/schemas/question.ts` | Add approval fields + ApproveQuestionDTO | ⏳ |
| `apps/functions/src/helpers/xlsx-form-parser.ts` | Mark + matrix metadata | ⏳ |
| `apps/functions/src/helpers/textract-forms.ts` | Mark detection on KEY_VALUE_SET blocks | ⏳ |
| `apps/functions/src/handlers/question-pipeline/detect-required-forms.ts` | Call `autofillMatrixComments` for XLSX_MATRIX | ⏳ |
| `apps/functions/src/handlers/required-forms/delete-required-form.ts` | Admin-only check | ⏳ |
| `apps/functions/src/handlers/required-forms/save-form-fields.ts` | Auto-attach on DONE | ⏳ |
| `apps/functions/src/handlers/required-forms/update-form-field.ts` | Accept mark fields, auto-attach on DONE | ⏳ |
| `apps/functions/src/handlers/required-forms/export-filled-form.ts` | XLSX literal char + PDF SVG stamps | ⏳ |
| `apps/functions/src/handlers/rfp-document/generate-document-worker.ts` | Include attached forms in proposal package | ⏳ |
| `apps/functions/src/helpers/generate-document-worker.ts` | Manifest assembly with form marker | ⏳ |
| `apps/web/features/required-forms/components/XlsxFormEditor.tsx` | X / ○ toggle buttons | ⏳ |
| `apps/web/features/required-forms/components/PdfFormEditor.tsx` | Stamp tool palette | ⏳ |
| `apps/web/app/organizations/[orgId]/projects/[projectId]/opportunities/[oppId]/page.tsx` | Insert Required Forms section | ⏳ |
| `packages/infra/api/routes/required-forms.routes.ts` | New attach routes + log groups | ⏳ |
| `packages/infra/api/routes/questions.routes.ts` | New approve route + log group | ⏳ |
