# Plan-Governed Cost Consistency — Implementation Document

> ALL costs (one-time, ongoing, labor) come from the Solution Plan's structured cost schedule;
> both pricing documents copy it, with deterministic auto-correct + warn reconciliation.
> Follow-up to `docs/PRICING-CONSISTENCY-IMPLEMENTATION.md` (Fix A/B).
> Investigated on opportunity `25c72a7e-f3ea-4a72-a5a3-7b132070e7f3` (2026-08-17).

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Problem 1** | Even with Fix A live (verified in dev worker logs: plan injected, `search_service_pricing` withheld), COST_PROPOSAL and PRICE_VOLUME report different totals for the same opportunity (ongoing fees $4,800/yr vs $4,440/yr; one-time $34,720 vs $38,880). Fix A pins only **third-party** prices; own-service/labor costs (managed hosting, maintenance, support) are ungoverned, so each document's LLM composes its own fee schedule. |
| **Problem 2** | The plan reaches documents only as flattened plain text (`stripHtmlToText`, 12k budget) — table structure is lost and there is no deterministic check that document numbers match the plan. |
| **Problem 3** | Fix B (`correctPricingTableTotals`) made a real false correction: in the Price Volume's "Reconciliation to Proposed Price" table (component rows, not addends), it rewrote `Total ODCs (Travel + Plugins)` $2,140.00 → $39,740.00 (CloudWatch, 2026-08-17T15:55). |
| **Fix 1** | **Structured cost schedule on the plan** — synthesis emits `costSchedule` (all cost items: one-time / monthly / annual, incl. labor & own services); worker deterministically recomputes totals and persists it on the plan record. |
| **Fix 2** | **Schedule as the single source in documents** — code-rendered "AUTHORITATIVE COST SCHEDULE" block injected into pricing-document prompts + strengthened rules (every dollar = schedule item, sum of items, or exact ×12/÷12 conversion). |
| **Fix 3** | **Deterministic reconciliation** — post-generation pass forces one-time / ongoing-annual / monthly total rows to the schedule values. Enforcement: **auto-correct + warn** (product decision, 2026-08-17) — never fail generation. |
| **Fix 4** | **Fix B false-positive** — the "sum prior totals" fallback fires only for grand-labeled rows. |
| **Scope decisions** | Backend only, no UI (product decision). Legacy plans without a schedule keep current Fix A behavior. User-edited plans clear the schedule (fall back to Fix A until regenerated). |
| **Packages touched** | `packages/core`, `apps/functions` |
| **Infra changes** | None |

> ⚠️ Retest caveat: on the test opportunity, the READY plan describes the **wrong solicitation** (ACWS/Appian — built from the stale 2026-08-10 exec brief) while the pricing docs target RFP 121251. This feature guarantees doc↔plan consistency, not plan correctness. Retest on a clean opportunity (or regenerate the exec brief first). The bundled-opportunity target-solicitation picker remains out of scope.

---

## 2. Design Decisions <!-- ✅ IMPLEMENTED -->

| Decision | Choice | Rationale |
|---|---|---|
| Pass ordering | `correctPricingTableTotals` (Fix B) FIRST, `reconcileTotalsWithPlan` LAST (last writer) | Fix B after reconciliation would overwrite every plan-forced value. Running Fix B first means reconciliation's WARN measures genuine line-item divergence from the plan, not LLM arithmetic slips. Residual internal deltas after forcing are WARN-logged (`docTotal/planTotal/delta`). |
| Synthesis schema robustness | `costSchedule: SolutionPlanCostScheduleSchema.nullish().catch(undefined)` in the worker's `SynthesisResponseSchema` | `invokeClaudeJson` has no schema-retry — a present-but-malformed schedule would otherwise FAIL the whole plan. Malformed/omitted degrades to "absent + warn". |
| Model-stated totals | Always overwritten by `computeCostScheduleTotals` before persisting | LLM sums are unreliable (the original incident). |
| User plan edits | Clear `costSchedule` (`null`) in `updateSolutionPlanContent` | Edited HTML may change prices; a stale schedule silently forcing old totals is worse than Fix A fallback. |
| Mismatch handling | Auto-correct the total cell + WARN log | Product decision. Never fail the job; reconciliation call sites wrapped in try/catch. |
| Multi-money-cell total rows (Year 1 \| Year 2 \| Year 3 layouts) | Skipped + WARN | No safe way to know which column is "the annual" one; a 3-year column must NOT equal `ongoingAnnualTotal`. Fix B still keeps each column internally consistent. |

Reconciliation guards (a row is touched only if ALL hold):
- First cell matches the existing `TOTAL_LABEL_RE` (`/\b(?:sub[\s-]?)?total\b/i`).
- Exactly ONE money cell in the row.
- Label is not year-qualified: skip on `/\byears?\s*\d|\d+\s*(?:[-–—]\s*\d+\s*)?[-\s]?years?\b/i` ("Year 1 Total", "3-Year Total").
- Label matches exactly one bucket (both one-time and ongoing → skip + WARN).

Bucket regexes (first match wins):

```ts
const MONTHLY_TOTAL_RE        = /\bmonthly\b|\bper\s+month\b|\bMRC\b/i;              // → ongoingAnnualTotal / 12
const ONE_TIME_TOTAL_RE       = /\bone[-\s]?time\b|\bnon[-\s]?recurring\b|\bNRC\b/i; // → oneTimeTotal
const ONGOING_ANNUAL_TOTAL_RE = /\bongoing\b|\brecurring\b|\bannual(?:ized)?\b|\bper\s+year\b|\byearly\b|\bARC\b/i; // → ongoingAnnualTotal
```

Correction fires only when |stated − target| > $1.00 (reuse `TOLERANCE`). Grand-labeled rows with no data rows since the previous total are recomputed from effective (post-force) prior totals. A pricing doc with a schedule but zero candidate rows emits a WARN (observability).

---

## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->

All in `packages/core/src/schemas/solution-plan.ts` (existing file):

```typescript
export const SolutionPlanCostCategorySchema = z.enum(['LABOR', 'THIRD_PARTY', 'ODC', 'OTHER']);
export const SolutionPlanCostBillingSchema  = z.enum(['ONE_TIME', 'MONTHLY', 'ANNUAL']);

export const SolutionPlanCostItemSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  category: SolutionPlanCostCategorySchema.catch('OTHER').default('OTHER'),
  /** null = vendor quote required (no verified price) */
  amount: z.number().nonnegative().nullable(),
  billing: SolutionPlanCostBillingSchema,
});

export const SolutionPlanCostScheduleSchema = z.object({
  currency: z.string().default('USD'),
  items: z.array(SolutionPlanCostItemSchema).min(1),
  /** Deterministically recomputed by the synthesis worker — model-stated values are overwritten */
  oneTimeTotal: z.number().nonnegative(),
  ongoingAnnualTotal: z.number().nonnegative(),
  assumptions: z.array(z.string()).optional(),
});
export type SolutionPlanCostSchedule = z.infer<typeof SolutionPlanCostScheduleSchema>;
export type SolutionPlanCostItem = z.infer<typeof SolutionPlanCostItemSchema>;
```

- `SolutionPlanItemSchema` (line ~140): add `costSchedule: SolutionPlanCostScheduleSchema.nullish()` (nullable so the user-edit path can clear it; optional so legacy records parse).
- `SolutionPlanStatusPatchSchema` (lines ~189–201): add `costSchedule: true` to the pick list.
- No change to `SolutionPlanListItemSchema` or response schemas.
- Rebuild core (`pnpm --filter @auto-rfp/core build`) before dependent work.

## 4. DynamoDB Design <!-- ✅ IMPLEMENTED -->

No new partitions/SKs/GSIs. One new attribute on the existing `SOLUTION_PLAN` item: `costSchedule` (map, nullable), written by the synthesis READY patch through `updateSolutionPlanStatus`. Absent on legacy plans — no migration.

---

## 5. Backend — Helpers & Handlers <!-- ✅ IMPLEMENTED -->

### 5.1 New helper `apps/functions/src/helpers/cost-schedule.ts`

```typescript
export const computeCostScheduleTotals = (items: SolutionPlanCostItem[]):
  { oneTimeTotal: number; ongoingAnnualTotal: number };
// oneTimeTotal       = Σ non-null ONE_TIME amounts
// ongoingAnnualTotal = Σ non-null ANNUAL + 12 × Σ non-null MONTHLY, rounded to cents

export const renderCostScheduleBlock = (schedule: SolutionPlanCostSchedule): string;
// Deterministic fixed-format text block:
// "AUTHORITATIVE COST SCHEDULE (SOURCE OF TRUTH — COPY THESE NUMBERS EXACTLY)"
// one line per item: label | category | billing | "$X" or "vendor quote required"
// footer: TOTAL ONE-TIME / TOTAL ONGOING (ANNUAL) + the (a)/(b)/(c) usage rule:
// every dollar figure must be (a) an item amount verbatim, (b) a sum of item amounts,
// or (c) an exact ×12/÷12 monthly↔annual conversion; document totals MUST equal these exactly.
```

### 5.2 Synthesis emits & persists the schedule

**`solution-plan-prompts.ts`** — `buildSynthesizerSystemPrompt` (lines 165–188): output format becomes `{"title", "htmlContent", "costSchedule": {...}}`; add COST SCHEDULE RULES: every cost in "Selected Services & Licenses" and "Cost Drivers & Assumptions" appears as an item; own-service/labor costs (hosting, maintenance, support) are items too; `amount` is a plain number (no `$`/commas) or `null` for vendor-quote-required; totals recomputed server-side.

**`solution-plan-worker.ts`** (lines 151–154, 332–380):

```typescript
const SynthesisResponseSchema = z.object({
  title: z.string().min(1),
  htmlContent: z.string().min(1),
  costSchedule: SolutionPlanCostScheduleSchema.nullish().catch(undefined), // malformed/omitted → warn, never FAILED
});
```

In `processSynthesis`: when present, overwrite totals via `computeCostScheduleTotals(costSchedule.items)`; persist `costSchedule: normalized ?? null` in the READY patch (lines 364–372). When absent: `console.warn('[solution-plan-worker] synthesis returned no usable costSchedule — documents fall back to Fix A behavior')`.

### 5.3 Clear on user edit

**`solution-plan.ts`** — `updateSolutionPlanContent` (lines 115–143): add `costSchedule: null` to the update object; log the clearing. (Re-init is safe automatically — `putSolutionPlan` full-replaces.)

### 5.4 Fix B false-positive fix

**`pricing-table-math.ts`** (line ~162): gate the "sum prior totals" fallback on `isGrandLabel` — a non-grand total row with no data rows since the previous total is a *component* row (e.g. "Total ODCs" under "Total Labor" in a reconciliation table); leave it untouched; its stated value still feeds `priorTotals` for a later grand total. Existing 17 tests stay green (the subtotal+grand fixture is grand-labeled). Export primitives for reuse: `stripTags`, `parseCells`, `formatMoney`, `roundCents`, `MONEY_RE`, `TABLE_RE`, `ROW_RE`, `TOTAL_LABEL_RE`, `GRAND_LABEL_RE`, `TOLERANCE`. Update the doc comment.

### 5.5 New helper `apps/functions/src/helpers/plan-cost-reconciliation.ts` (pure)

```typescript
export type ReconciliationBucket = 'ONE_TIME' | 'ONGOING_ANNUAL' | 'ONGOING_MONTHLY' | 'GRAND';
export interface PlanTotalCorrection {
  tableIndex: number; rowLabel: string; bucket: ReconciliationBucket;
  previousValue: string; correctedValue: string;
}
export interface PlanReconciliationResult { html: string; corrections: PlanTotalCorrection[]; warnings: string[]; }
export const reconcileTotalsWithPlan = (html: string, schedule: SolutionPlanCostSchedule): PlanReconciliationResult;
```

Built on the exported pricing-table-math primitives, implementing §2's guards/buckets/grand-recompute.

### 5.6 Prompt injection — `document-prompts.ts`

- `UserPromptContext` (lines ~1285–1293): add `solutionPlanCostSchedule?: SolutionPlanCostSchedule | null`.
- `buildUserPromptForDocumentType` (~1300–1357): for `PRICING_RULES_DOC_TYPES` with a schedule, append `renderCostScheduleBlock(schedule)` directly under the APPROVED SOLUTION PLAN block (~1312–1324).
- `buildPricingGuidanceRules(true)` (lines 36–50): extend the with-plan variant to PLAN-GOVERNED COSTS — ALL costs (one-time, ongoing, labor-based incl. hosting/maintenance/support) come from the plan; when the AUTHORITATIVE COST SCHEDULE block is present, the (a)/(b)/(c) rule and exact-total requirement apply. Conditional phrasing — no signature changes to `buildSystemPromptForDocumentType` / `buildSectionSystemPrompt`.
- `DOC_TYPE_TASK.COST_PROPOSAL` (~1017–1033) and `.PRICE_VOLUME` (~1100–1115): one added numbered instruction referencing the schedule.
- Export `buildPricingRulesBlock` (needed by §5.8).
- `document-section-generator.ts` needs NO change — the schedule block rides in `initialUserPrompt` (prepended to every section prompt at line 197) and `buildSectionSystemPrompt` already appends `buildPricingRulesBlock` (line 1233).

### 5.7 Worker hook — `generate-document-worker.ts`

- Line ~1113: pass `solutionPlanCostSchedule: solutionPlanContext?.plan.costSchedule ?? null` into `buildUserPromptForDocumentType`.
- After the Fix B pass (lines 1390–1402): when `PRICING_TOOL_DOC_TYPES.has(documentType)` and a schedule exists, run `reconcileTotalsWithPlan` in try/catch; WARN-log corrections (`"Total Ongoing": $4,440 → $4,800 (plan)`) and warnings; assign corrected HTML. Never fail the job on reconciliation errors.

### 5.8 `handlers/rfp-document/edit-section.ts`

- Load the plan (timeout-wrapped `getSolutionPlanByOpportunity(...).catch(() => null)`, only for pricing doc types); schedule = `plan?.status === 'READY' && doc.solutionPlanId ? plan.costSchedule : null`.
- `buildSectionEditSystemPrompt` (line 87): append `buildPricingRulesBlock(documentType, hasSolutionPlan)` — **currently missing entirely** (verified: pricing edits today run without any mandatory pricing rules).
- Add the rendered schedule block to the section-edit user prompt; run `reconcileTotalsWithPlan` after the Fix B pass (lines 483–492), same warn semantics.

---

## 6. WebSocket Infrastructure <!-- ⏭️ SKIPPED (not applicable) -->

## 7. REST API Routes <!-- ⏭️ SKIPPED (no new routes) -->

## 8. Frontend <!-- ⏭️ SKIPPED (backend only — product decision 2026-08-17; additive optional schema field, web typecheck unaffected) -->

## 9. Permissions & RBAC <!-- ⏭️ SKIPPED (no changes) -->

## 10. Email Notifications <!-- ⏭️ SKIPPED (not applicable) -->

## 11. CDK Stack Updates <!-- ⏭️ SKIPPED (no changes) -->

---

## 12. Implementation Tickets <!-- ✅ IMPLEMENTED -->

### CS-1 · Core schemas: cost schedule (45 min) <!-- ✅ IMPLEMENTED -->
- Files: `packages/core/src/schemas/solution-plan.ts` (+ `solution-plan.test.ts`)
- New cost item/schedule schemas; `costSchedule` on `SolutionPlanItemSchema` (nullish) and in `SolutionPlanStatusPatchSchema` pick.
- Tests: null amount accepted, negative rejected; schedule min-1 item; legacy Item parses without the field; patch accepts it.
- ✅ Done when: core builds; `apps/functions` and `apps/web` typecheck.

### CS-2 · `cost-schedule.ts` helper (45 min) <!-- ✅ IMPLEMENTED -->
- Files: `apps/functions/src/helpers/cost-schedule.ts` (NEW) + test
- `computeCostScheduleTotals` (ANNUAL + 12×MONTHLY, null exclusion, cent rounding), `renderCostScheduleBlock` (fixed format + (a)/(b)/(c) rule).

### CS-3 · Synthesis emits & persists schedule (1.5 h) <!-- ✅ IMPLEMENTED -->
- Files: `helpers/solution-plan-prompts.ts`, `helpers/solution-plan-worker.ts` (+ tests)
- Prompt output shape + COST SCHEDULE RULES; `SynthesisResponseSchema` with `.nullish().catch(undefined)`; totals recomputed; persisted in READY patch; warn on absence.
- Tests: recomputed totals overwrite model values; malformed schedule → READY without schedule + warn (not FAILED); prompt mentions `costSchedule` + billing enum.

### CS-4 · Clear schedule on user edit (30 min) <!-- ✅ IMPLEMENTED -->
- Files: `helpers/solution-plan.ts`, `handlers/solution-plan/update-solution-plan.test.ts`
- `updateSolutionPlanContent` writes `costSchedule: null`; test: edit clears it.

### CS-5 · Fix B false-positive fix (45 min) <!-- ✅ IMPLEMENTED -->
- Files: `helpers/pricing-table-math.ts` (+ test)
- Grand-only prior-totals fallback; export primitives; regression fixture from the 2026-08-17 incident (Total Labor / Total ODCs / Less: Efficiency Adjustment → Total ODCs untouched); existing grand-after-subtotals still corrected.

### CS-6 · `plan-cost-reconciliation.ts` (2.5 h) <!-- ✅ IMPLEMENTED -->
- Files: `helpers/plan-cost-reconciliation.ts` (NEW) + test
- Guards, buckets, monthly÷12, grand recompute from effective prior totals, zero-candidate warning.
- Tests: forces one-time / ongoing-annual / monthly; within-$1 untouched; year-column tables skipped+warn; year-qualified labels skipped; ambiguous labels skipped; grand recompute; zero-candidate warning.

### CS-7 · Prompt injection + worker hook (1.5 h) <!-- ✅ IMPLEMENTED -->
- Files: `helpers/document-prompts.ts`, `helpers/generate-document-worker.ts` (+ tests)
- `solutionPlanCostSchedule` in `UserPromptContext`; schedule block under the plan block; PLAN-GOVERNED COSTS rules; DOC_TYPE_TASK instructions; worker passes schedule + runs reconciliation after Fix B (try/catch, warn logs).
- Tests: block rendered only for pricing types with a schedule; reconciliation hook order.

### CS-8 · edit-section: rules block + schedule + reconciliation (1.5 h) <!-- ✅ IMPLEMENTED -->
- Files: `handlers/rfp-document/edit-section.ts` (+ test)
- Plan load; `buildPricingRulesBlock` appended to the section-edit system prompt (bug fix); schedule block in user prompt; reconciliation after Fix B.

**Order:** CS-1 → CS-2 → (CS-3, CS-4) and (CS-5 → CS-6) in parallel → CS-7 → CS-8.

---

## 13. Acceptance Criteria Checklist <!-- ✅ IMPLEMENTED -->

- [x] Newly synthesized plans persist `costSchedule` with server-recomputed totals; malformed model output never FAILs the plan.
- [x] User-editing a plan clears `costSchedule`; regeneration restores it.
- [x] COST_PROPOSAL and PRICE_VOLUME prompts contain the AUTHORITATIVE COST SCHEDULE block when the plan has one; non-pricing types never do.
- [x] Generated one-time and ongoing-annual totals equal the schedule totals exactly (auto-corrected + WARN-logged when the model diverged).
- [ ] Regenerating both pricing documents for a clean opportunity with a schedule-bearing plan yields **identical one-time and ongoing totals across the two documents**, equal to the plan's.
- [x] The reconciliation-table false positive is fixed: `Total ODCs` component rows are never rewritten; year-column tables and year-qualified totals are skipped with warnings.
- [x] Legacy plans (no schedule) and plan-less orgs behave exactly as today.
- [x] Section edits on pricing documents receive the mandatory pricing rules block (previously missing) and reconciliation.
- [ ] `pnpm tsc --noEmit` passes in `packages/core`, `apps/functions`, `apps/web`; all new/updated vitest + Jest suites pass.

---

## 14. Summary of New Files <!-- ✅ IMPLEMENTED -->

| File | Purpose | Status |
|---|---|---|
| `apps/functions/src/helpers/cost-schedule.ts` | Totals math + deterministic prompt-block rendering | ✅ |
| `apps/functions/src/helpers/cost-schedule.test.ts` | Totals/rendering unit tests | ✅ |
| `apps/functions/src/helpers/plan-cost-reconciliation.ts` | Pure doc↔plan totals reconciliation (auto-correct + warn) | ✅ |
| `apps/functions/src/helpers/plan-cost-reconciliation.test.ts` | Reconciliation unit tests (incident fixtures) | ✅ |

All other changes modify existing files (per ticket in §12).

---

## Verification (end-to-end, dev stage)

1. `pnpm --filter @auto-rfp/core build && pnpm --filter @auto-rfp/core test` → `cd apps/functions && pnpm test && pnpm build` → `cd apps/web && npx tsc --noEmit`.
2. Deploy (`pnpm deploy:dev:hotswap`).
3. On a **clean opportunity** (exec brief matches the solicitation — see §1 caveat): regenerate the Solution Plan → confirm `costSchedule` persisted with recomputed totals in DynamoDB.
4. Generate COST_PROPOSAL **and** PRICE_VOLUME → both documents' one-time and ongoing-annual totals equal the schedule's exactly and each other's.
5. Check CloudWatch worker logs for `reconcileTotalsWithPlan` corrections/warnings and absence of false Fix B corrections on reconciliation tables.

## Known v1 limitations (accepted)

- User-edited plans lose deterministic reconciliation until regenerated (Fix A fallback).
- Multi-money-cell total rows (Year 1 | Year 2 | Year 3 layouts) are prompt-governed only (skipped by reconciliation, warn-logged).
- Existing READY plans have no schedule until regenerated — behavior unchanged for them.
- Bundled/multi-solicitation opportunities can still produce a plan for the wrong solicitation (out of scope — target-solicitation picker).