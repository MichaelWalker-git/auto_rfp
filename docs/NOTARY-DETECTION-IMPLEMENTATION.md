# Notary Requirement Detection — Implementation Plan <!-- ⏳ PENDING -->

> Detects when a form or certification in an RFP package **requires notarization**,
> so the team learns early which documents must be taken to a notary and signed
> before submission — instead of discovering it late. Detection runs **where the
> notary signal and page numbers already exist** (the required-forms pipeline),
> surfaces a **per-form label** in the forms UI, and rolls up to an
> **opportunity-level badge** visible on the opportunity card at a glance.
>
> **Planning artifact only — no code in this session.** This plan was shaped by a
> codebase analysis of the compliance-review checks (C1–C6), the required-forms
> Textract pipeline, and the Executive Brief. Several choices below deliberately
> depart from the original AI-generated ticket; the departures and their rationale
> are recorded in §1. Do not "simplify" past them without re-reading the rationale.

---

## 0. TL;DR for the implementing agent

- **Pattern:** the same **two-stage pipeline** already proven in `compliance-review-*.ts`
  — loose deterministic candidate generation (high recall) → one batched Bedrock
  verification call (precision gate). **Fail toward reporting** (a missed notary is
  the critical failure), mirroring the C5 NDA-leak posture.
- **Detect where the data lives, not "later":** per-form raw text is **never
  persisted** (only `DetectedFormField[]`). So the scan runs at two points that
  already hold the text in memory:
  1. `detect-required-forms.ts` — whole-document solicitation text (`docText`) is
     in memory; scan it for **instructional** notary language and map it to the
     detected form names.
  2. `textract-forms-callback.ts` — for PDF forms, all Textract blocks (LINE/WORD
     **with `.Page`**) are in memory; scan them for **acknowledgment-block** cues
     with real page numbers.
- **Three states → `notaryStatus` enum + severity:** `REQUIRED` / `POSSIBLY_REQUIRED`
  ("review needed") / `NOT_REQUIRED`.
- **Two surfaces:** per-form label (`RequiredForm.notaryStatus`) + an
  opportunity-level rollup badge (`OpportunityItem.notarySummary`, mirrored into
  `OpportunityListItem`).
- **Optional free win:** a `NOTARY_REQUIRED` compliance-review finding that reads
  the already-stored classification (no extra model cost).
- **New infra:** none. Reuse the existing Step Function, Textract callback, SQS,
  DynamoDB, and Bedrock HTTP client.

---

## 1. Corrections to the original ticket (READ FIRST)

The original ticket was AI-generated and its proposed approach is wrong in five
concrete ways. Each correction is grounded in a codebase fact.

| Ticket said | Reality (file evidence) | What we do instead |
|---|---|---|
| "Flag specific **pages**" for every document | The general solicitation/RFP **body is stored flat and pageless** — Textract's `block.Page` is discarded in `helpers/textract.ts:41` (only `LINE` blocks joined by `\n`); DOCX via mammoth `extractRawText` has no page concept. The compliance-review finding anchor union is `heading \| cell \| field` — **no page anchor**. Page numbers survive **only** in the required-forms path (`textract-forms.ts` uses `FeatureTypes:['FORMS','SIGNATURES']` and keeps `k.Page`; `DetectedFormField.pageNumber`, `RequiredForm.sourcePageRange`). | **Page-level citation for form-anchored detections** (that's where the notary blocks are anyway); **document + verbatim snippet** for solicitation-body instructional language (no page exists — state that honestly). |
| Flag in the "**Executive Brief / compliance matrix**" | These are **unrelated features**. The Brief is a bid/no-bid intake doc built from flat solicitation text and **never reads form records**. There is **no compliance-matrix report** — compliance review surfaces findings as cards + a stats banner. The Brief and forms pipelines are **independent flows that race** (see §2). | Surface the **per-form label** in the forms UI + an **opportunity-level rollup badge**. (Brief integration is possible later but is NOT the right primary surface — it can't cite a page and doesn't see forms.) |
| Detect inside "the proposal workflow" as a new step | Notary language + page numbers **already exist** in the required-forms pipeline — `ALWAYS_MANUAL_PATTERNS` in `textract-forms.ts:58-65` already matches `/notary/i` and `/witness/i` today; it just isn't **classified** or **rolled up**. | Extend the **existing** required-forms detection, don't add a parallel pipeline. |
| Three states as a per-document boolean-ish field | Findings/labels are richer than a boolean. | Model as a `notaryStatus` enum + a severity mapping (`REQUIRED`→`major`, `POSSIBLY_REQUIRED`→`minor`/"review needed", `NOT_REQUIRED`→no flag). |
| ">90% accuracy vs 5 real packages", "Brennen confirms" as build tasks | These are **validation/acceptance criteria**, not build steps. No labeled corpus exists in-repo, but an `evals/` harness pattern does (`evals/executive-brief/`). | Ship unit tests on the deterministic scanner + a small labeled fixture set under `evals/notary/`; treat the >90% / human-confirm gates as **acceptance**, not blockers to writing the code. |

**Non-negotiable design stance (from "false negatives are worse"):** the Stage-1
generator is tuned LOOSE (high recall) and, when the Stage-2 verification model
call fails, we **keep** candidates as `POSSIBLY_REQUIRED` rather than dropping them
— exactly as `compliance-review-nda-leak.ts` keeps ambiguous candidates on model
failure (fail toward reporting).

---

## 2. Why detection is split across two hook points (the timing constraint)

Forms detection and Executive Brief generation are **independent, data-disjoint
flows that race off the same upload** (verified):

- The required-forms records are created inside the question-pipeline Step Function
  at the `detectForms` task (`packages/infra/question-pipeline-step-function.ts`),
  which runs **before** `extractQuestions` writes `PROCESSED`.
- For **PDF** forms, field extraction is **asynchronous**: `detect-required-forms.ts`
  only *starts* a Textract `StartDocumentAnalysis` job; fields aren't `READY` until
  the SNS callback `textract-forms-callback.ts` fires — **after the Step Function
  has ended**.
- The Brief auto-generates as soon as files reach `PROCESSED` and **never reads
  form records** — so a Brief-time notary computation would miss PDF form fields
  entirely.

Consequence — the notary signal physically lives in **two places**, captured by
**two hooks**:

```
detect-required-forms.ts   (SYNC, whole docText in memory)
    │  Signal A — INSTRUCTIONAL language in the solicitation body
    │  ("Attachment C (Non-Collusion Affidavit) must be notarized")
    │  → map to the detected form NAME; set that form's notaryStatus
    │  → unmappable instruction → opportunity rollup "possibly required / review"
    │  Also handles XLSX/DOCX forms parsed inline to READY here.
    ▼
textract-forms-callback.ts (ASYNC SNS, all Textract blocks incl. LINE/WORD + .Page)
    │  Signal B — ACKNOWLEDGMENT BLOCK on the form's own pages
    │  ("State of ___ / County of ___", "subscribed and sworn before me",
    │   "my commission expires", notary seal placeholder) — carries pageNumber
    │  → set that PDF form's notaryStatus with page + verbatim snippet
    ▼
mark-forms-ready.ts  → when all forms terminal, recompute the opportunity rollup
```

Both hooks call the **same** `computeNotaryRequirements()` engine (§4) over whatever
text they hold; the engine is source-agnostic.

---

## 3. Data Models & Zod Schemas — `packages/core` <!-- ⏳ PENDING -->

### 3.1 New file: `packages/core/src/schemas/notary.ts`

```typescript
import { z } from 'zod';

/** Three-state classification. POSSIBLY_REQUIRED == "review needed". */
export const NotaryStatusSchema = z.enum(['REQUIRED', 'POSSIBLY_REQUIRED', 'NOT_REQUIRED']);
export type NotaryStatus = z.infer<typeof NotaryStatusSchema>;

/** Which cue triggered the classification (for UI grouping + tuning telemetry). */
export const NotaryCueSchema = z.enum([
  'KEYWORD',        // "notary", "notarized", "notary public"
  'ACK_BLOCK',      // blank notary acknowledgment block
  'STATE_COUNTY',   // "State of ___ / County of ___"
  'COMMISSION',     // "my commission expires", seal/stamp placeholder
  'SWORN',          // "subscribed and sworn", "sworn before me"
  'WITNESS',        // "witnessed by a notary public"
  'INSTRUCTIONAL',  // "must be notarized", "requires a notary" (solicitation body)
]);
export type NotaryCue = z.infer<typeof NotaryCueSchema>;

/** One detected notary trigger, anchored as precisely as the source allows. */
export const NotaryRequirementSchema = z.object({
  /** The detected form this points at (absent for an unmapped solicitation instruction). */
  formId: z.string().optional(),
  /** Form name or solicitation document name — always present for display. */
  documentName: z.string().min(1),
  status: NotaryStatusSchema,
  cue: NotaryCueSchema,
  /** Present for form-anchored (PDF) triggers; null for flat solicitation-body text. */
  pageNumber: z.number().int().positive().nullable().default(null),
  /** Verbatim excerpt — the evidence + the false-positive guardrail audit trail. */
  triggeringText: z.string().min(1),
  /** One-line model rationale (why this status, esp. for POSSIBLY_REQUIRED). */
  rationale: z.string().optional(),
});
export type NotaryRequirement = z.infer<typeof NotaryRequirementSchema>;

/** Opportunity-level rollup — the at-a-glance summary the card badge reads. */
export const NotarySummarySchema = z.object({
  /** true if ANY form/instruction is REQUIRED or POSSIBLY_REQUIRED. */
  anyNotaryRequired: z.boolean().default(false),
  requiredCount: z.number().int().nonnegative().default(0),
  possiblyRequiredCount: z.number().int().nonnegative().default(0),
  /** Denominator for "2 of 6 forms need notarization". */
  totalFormsConsidered: z.number().int().nonnegative().default(0),
  computedAt: z.string().datetime().optional(),
});
export type NotarySummary = z.infer<typeof NotarySummarySchema>;
```

Add `export * from './notary';` to `packages/core/src/schemas/index.ts`.

### 3.2 Extend `packages/core/src/schemas/required-form.ts`

Add per-form notary state to `RequiredFormItemSchema` (after `errorMessage`):

```typescript
  notaryStatus: NotaryStatusSchema.default('NOT_REQUIRED'),
  /** The triggers behind notaryStatus for this form (page + snippet). */
  notaryRequirements: z.array(NotaryRequirementSchema).default([]),
```

Mirror the new fields into `UpdateRequiredFormDTOSchema` so the callback/detection
step can patch them (they follow the existing `.partial()`-style optional pattern).

### 3.3 Extend `packages/core/src/schemas/opportunity.ts`

Add the rollup to **both** shapes (the card is typed against the hand-maintained
subset, not a `.pick()` of the full item — a field added only to the full item
would never reach the card):

- `OpportunityItemSchema` (~`:222-357`): add `notarySummary: NotarySummarySchema.nullable().default(null)`.
- `OpportunityListItemSchema` (~`:415-440`): add the same `notarySummary` field.

**Verify:** `pnpm --filter @auto-rfp/core build`, then dependent typechecks.

---

## 4. Detection engine — `apps/functions/src/helpers/notary-detection.ts` <!-- ⏳ PENDING -->

The single, source-agnostic engine both hooks call. Mirrors the shape of
`compliance-review-nda-leak.ts` / `compliance-review-cert.ts`.

### 4.1 Stage 1 — deterministic candidate generation (LOOSE = high recall)

A tunable pattern table (the recall ceiling; loosen here, never the prompt):

```typescript
const NOTARY_PATTERNS: Array<{ cue: NotaryCue; re: RegExp }> = [
  { cue: 'KEYWORD',       re: /\bnotar(?:y|ized|ization|ised|isation)\b/i },
  { cue: 'KEYWORD',       re: /\bnotary\s+public\b/i },
  { cue: 'SWORN',         re: /\bsubscribed\s+and\s+sworn\b/i },
  { cue: 'SWORN',         re: /\bsworn\s+(?:to\s+and\s+)?(?:subscribed\s+)?before\s+me\b/i },
  { cue: 'STATE_COUNTY',  re: /\bstate\s+of\s+_{2,}|\bcounty\s+of\s+_{2,}/i },
  { cue: 'STATE_COUNTY',  re: /\bstate\s+of\s+[a-z ]+\)?\s*\)?\s*(?:ss\.?|county\s+of)\b/i },
  { cue: 'COMMISSION',    re: /\bmy\s+commission\s+expires\b/i },
  { cue: 'COMMISSION',    re: /\bnotary\s+(?:seal|stamp)\b|\bseal\s+of\s+notary\b/i },
  { cue: 'WITNESS',       re: /\bwitnessed?\s+by\s+a?\s*notary\b/i },
  { cue: 'INSTRUCTIONAL', re: /\b(?:must\s+be\s+notarized|requires?\s+a?\s*notary|shall\s+be\s+notarized)\b/i },
];
```

Reuse the shared primitives from `compliance-review-text.ts` (`norm`, `escapeRegex`)
and the snippet-window helper pattern (±60 chars) from `compliance-review-nda-leak.ts`.

Two candidate generators (called by the two hooks):

- **`fromFormBlocks(blocks, form)`** — over Textract LINE blocks (callback):
  group by `block.Page`, run patterns per page, emit candidates with
  `{ formId, documentName: form.name, pageNumber: block.Page, cue, triggeringText }`.
  Also fold in the existing field-label signal (a field whose label already matched
  `/notary/i`).
- **`fromSolicitationText(docText, detectedForms)`** — over `docText` (detection
  step): run patterns; for each hit, attempt to associate it with a detected form
  by name proximity (reuse the conservative normalization already in
  `compliance-review-missing-forms.ts` / `detect-required-forms.ts` for form-name
  matching). Mapped → `{ formId, pageNumber: null, cue: 'INSTRUCTIONAL' }`;
  unmapped → `{ formId: undefined, documentName: <solicitation doc>, ... }`.

Over-flagging here is fine — Stage 2 is the precision gate.

### 4.2 Stage 2 — ONE batched Bedrock verification call (precision + guardrails)

Via `invokeModel` from `@/helpers/bedrock-http-client` (raw invoke, `temperature: 0`,
`max_tokens` bounded — mirrors every C-check), JSON-only output parsed with
`safeParseJsonFromModel` + a bespoke defensive parser.

The prompt classifies each candidate into `REQUIRED / POSSIBLY_REQUIRED /
NOT_REQUIRED` **and enforces the false-positive guardrails from the ticket**:

- Notary referenced **only for out-of-state bidders** → not required for this form → `NOT_REQUIRED` (or `POSSIBLY_REQUIRED` if the bidder's state is unknown).
- Notary offered as an **alternative to e-signature / another method** → `POSSIBLY_REQUIRED` (review needed), not a hard yes.
- Notary in a **definitions/instructions block** that doesn't bind the current form → `NOT_REQUIRED`.
- A real acknowledgment block / "must be notarized" bound to a form → `REQUIRED`.

**Fail toward reporting:** on any Stage-2 failure (model error, unparseable JSON),
**keep** all candidates as `POSSIBLY_REQUIRED` — never silently drop. (Exactly the
`pruneAmbiguous` catch-branch behavior in `compliance-review-nda-leak.ts`.)

Bound the candidate set with a `MAX_NOTARY_CANDIDATES` cap (mirror
`MAX_FACTUAL_CANDIDATES_PER_CHECK = 60`); overflow is surfaced as one
`POSSIBLY_REQUIRED` "review the package manually" rollup entry, never a silent drop.

### 4.3 Public API + telemetry

```typescript
export const computeNotaryRequirements = async (args: {
  orgId: string; modelId: string;
  candidates: NotaryCandidate[];   // from either generator
}): Promise<NotaryRequirement[]> => { /* Stage 2 + fail-open */ };
```

Log the tuning signal after Stage 2 (mirrors the `factual-candidates` line):
```ts
console.log(JSON.stringify({ tag: 'notary-candidates', source, generated, kept, byStatus }));
```

Best-effort throughout → `[]` on failure so a Bedrock/Textract hiccup never fails
the intake pipeline.

### 4.4 Constants — `apps/functions/src/constants/notary.ts`
`MAX_NOTARY_CANDIDATES`, `MAX_TOKENS_NOTARY`, snippet-context width, the model id
resolution (inherit the stack default `BEDROCK_MODEL_ID` — **do not pin** a route
model id; per project memory, pinned/EOL ids fail via the API key).

---

## 5. Backend wiring (no new Lambdas) <!-- ⏳ PENDING -->

### 5.1 `detect-required-forms.ts` (question-pipeline handler)
After forms are detected and `docText` is loaded (~`:193`), call
`fromSolicitationText(docText, detectedForms)` → `computeNotaryRequirements()` →
patch each mapped form's `notaryStatus`/`notaryRequirements` via `updateRequiredForm`.
For XLSX/DOCX forms parsed inline to `READY` here, also scan their extracted
field text. Best-effort; never throw into the Step Function.

### 5.2 `textract-forms-callback.ts` (SNS handler, PDF forms)
At `:73` the callback already holds `fetchAllAnalysisBlocks(JobId)` — the full
block list with LINE/WORD + `.Page`. Before/alongside the `updateRequiredForm({
..., status: 'READY' })` at `:90-97`, run `fromFormBlocks(blocks, form)` →
`computeNotaryRequirements()` and include `notaryStatus`/`notaryRequirements` in the
same patch (one write, no extra round-trip). Fail-open: a notary-scan error must
not block the form from reaching `READY`.

### 5.3 `mark-forms-ready.ts` — opportunity rollup
When `markFormsReadyIfAllDone` determines all forms are terminal (~`:36-58`),
aggregate every form's `notaryStatus` into a `NotarySummary` and write it to the
`OpportunityItem.notarySummary` (via the opportunity helper). This is the single
point where the at-a-glance badge value is computed, after all races resolve.
Also fold in any unmapped solicitation-instruction triggers.

### 5.4 Idempotency / re-run
Detection is derived state — recomputing overwrites `notaryStatus`/`notaryRequirements`
wholesale (no merge), so re-running the pipeline or re-uploading a form is safe and
converges. The rollup is always recomputed from the current forms.

---

## 6. Frontend <!-- ⏳ PENDING -->

### 6.1 Per-form label (required-forms feature)
In the forms list/detail component, render a notary badge from `form.notaryStatus`
using a Shadcn `Badge` (never raw HTML): `REQUIRED` (amber/red "Notary required"),
`POSSIBLY_REQUIRED` (yellow "Notary — review needed"), `NOT_REQUIRED` (no badge).
On expand, list `notaryRequirements` rows: page number (when present) · triggering
text · cue · rationale. Types imported from `@auto-rfp/core`.

### 6.2 Opportunity card badge (at-a-glance)
In `apps/web/components/opportunities/opportunity-item-card.tsx`, add a badge in
the footer chip row (~`:419-437`) or beside `OpportunityStatusBadge` (~`:364`),
driven by `item.notarySummary`. Example: **"⚖ Notary: 2 forms"** when
`anyNotaryRequired`. Reads from `OpportunityListItem.notarySummary` (§3.3 — must be
present on the list schema, not just the full item).

### 6.3 Loading/empty states
Notary summary may be `null` until forms finish processing (the race). Show nothing
(no badge) while null — never a spinner. Skeleton conventions apply if a dedicated
notary panel is added.

---

## 7. Optional — Compliance-review finding surface (free) <!-- ⏳ PENDING -->

Because the classification is already stored on each form, a compliance-review
augmenter can surface it as a finding at package-review time at **zero extra model
cost**:

1. Add `NOTARY_REQUIRED` to `ComplianceIssueTypeSchema`
   (`packages/core/src/schemas/compliance-review.ts:25`) **and** to the
   `.catch()`-guarded raw enum in `compliance-review-engine.ts:41`, plus a label in
   `FindingsStats.tsx:22`.
2. New `apps/functions/src/helpers/compliance-review-notary.ts` exporting
   `computeNotaryFindings({ orgId, oppId, inventory })` that reads the stored
   `RequiredForm.notaryStatus`/`notaryRequirements` and emits `NOTARY_REQUIRED`
   findings (`REQUIRED`→`major`, `POSSIBLY_REQUIRED`→`minor`), anchored via the
   existing `field` anchor kind. Wire one line into the `Promise.all` at
   `compliance-review-engine.ts:220-249`. Best-effort → `[]`.

This is additive and independent of §§4–6; ship it last.

---

## 8. Testing <!-- ⏳ PENDING -->

Maps 1:1 to the ticket's test scenarios (tests co-located, per `.claude/rules/09-testing.md`):

| Scenario | Test |
|---|---|
| Standalone notarized affidavit | `fromFormBlocks` emits `ACK_BLOCK`/`SWORN` candidate on the affidavit's page → `REQUIRED`. |
| Notary block embedded in a larger cert page | Candidate emitted for the notary block's page only; other pages `NOT_REQUIRED`. |
| Conditional notarization (only if claiming X / out-of-state) | Stage-2 guardrail → `POSSIBLY_REQUIRED` ("review needed"), not `REQUIRED`. |
| No notary requirement at all | Zero candidates → zero findings (**no false positives**). |
| Multi-form package, one form needs notary | Only that form flagged; rollup = "1 of N". |
| Stage-2 model failure | Candidates **kept** as `POSSIBLY_REQUIRED` (fail toward reporting). |
| e-signature alternative in boilerplate | Guardrail drops to `POSSIBLY_REQUIRED`/`NOT_REQUIRED`, not a hard yes. |

- **Unit:** `notary-detection.test.ts` — every `NOTARY_PATTERNS` entry (positive +
  negative), form-name mapping, snippet extraction, cap/overflow, fail-open.
- **Schema:** `notary.test.ts` (vitest) in core — enum validation, defaults.
- **Handler:** extend `textract-forms-callback.test.ts` and
  `detect-required-forms.test.ts` — mock blocks/`docText`, assert the patched
  `notaryStatus`; mock Bedrock (`invokeModel`) before imports.
- **Accuracy (acceptance, not a build blocker):** a small labeled corpus under
  `evals/notary/` (≥5 real packages with varying requirements) validated at >90%
  and zero unflagged true positives; final human confirm (Brennen) on the batch.

---

## 9. Acceptance criteria checklist

- [ ] Detection runs across PDF (Textract callback) and DOCX/XLSX (detection step) inputs.
- [ ] Correctly flags forms requiring notarization (>90% on the labeled corpus).
- [ ] Conditional/optional language flagged as `POSSIBLY_REQUIRED` ("review needed").
- [ ] No false positives on boilerplate/definitions/out-of-state/e-sig references.
- [ ] Output names the document + page (forms) or document + snippet (body text).
- [ ] Per-form badge visible in the forms UI; opportunity-level rollup badge on the card.
- [ ] **Zero unflagged true positives** (fail-toward-reporting verified in tests).
- [ ] No measurable added latency to Brief generation (detection is off its critical path).
- [ ] `pnpm --filter @auto-rfp/core build` + dependent typechecks pass; new code tested.

---

## 10. Summary of new/changed files

| File | Change | Status |
|---|---|---|
| `packages/core/src/schemas/notary.ts` | NEW — `NotaryStatus`, `NotaryCue`, `NotaryRequirement`, `NotarySummary` | ⏳ |
| `packages/core/src/schemas/index.ts` | add barrel export | ⏳ |
| `packages/core/src/schemas/required-form.ts` | add `notaryStatus` + `notaryRequirements` (item + update DTO) | ⏳ |
| `packages/core/src/schemas/opportunity.ts` | add `notarySummary` to Item **and** ListItem | ⏳ |
| `apps/functions/src/helpers/notary-detection.ts` | NEW — two-stage engine + both generators | ⏳ |
| `apps/functions/src/constants/notary.ts` | NEW — caps, tokens, model id resolution | ⏳ |
| `apps/functions/src/handlers/.../detect-required-forms.ts` | wire solicitation-text scan | ⏳ |
| `apps/functions/src/handlers/required-forms/textract-forms-callback.ts` | wire per-page block scan into the READY patch | ⏳ |
| `apps/functions/src/helpers/mark-forms-ready.ts` | compute + write opportunity `notarySummary` | ⏳ |
| forms feature UI (web) | per-form notary badge + detail rows | ⏳ |
| `apps/web/components/opportunities/opportunity-item-card.tsx` | opportunity rollup badge | ⏳ |
| `apps/functions/src/helpers/compliance-review-notary.ts` (+ engine/enum/label wiring) | OPTIONAL — finding surface | ⏳ |
| Tests: `notary-detection.test.ts`, `notary.test.ts`, handler tests, `evals/notary/` | NEW/extended | ⏳ |

---

## 11. Open decisions to confirm before implementation

1. **Opportunity write contention:** `mark-forms-ready.ts` already bulk-updates
   question files; writing `notarySummary` to the opportunity there is the cleanest
   single point, but confirm the opportunity helper's update path is safe to call
   from that handler (it's a different entity than the ones it touches today).
2. **DOCX/XLSX per-page:** those forms have no page numbers (no Textract FORMS run);
   their triggers carry `pageNumber: null` + snippet. Confirm that's acceptable for
   the UI (the ticket's "page/section" requirement is satisfied by section/snippet
   there).
3. **Model id:** inherit the stack default `BEDROCK_MODEL_ID`; do not pin (per
   project memory on Bedrock model-id pinning).
4. **Rollup on the card:** confirm the exact badge placement/wording with design
   (footer chip vs. top-row badge).
