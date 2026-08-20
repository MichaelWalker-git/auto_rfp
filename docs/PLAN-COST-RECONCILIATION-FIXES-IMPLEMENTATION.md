# Plan-Governed Cost Consistency — Reconciliation Fixes

> Follow-up to `docs/PLAN-COST-SCHEDULE-IMPLEMENTATION.md`. Fixes the three residual
> defects found on the first end-to-end retest (opportunity
> `b4ac1b8e-b882-4775-9ce3-1b37049e7876`, plan `d0750c0c` v3, docs generated
> 2026-08-18 10:43–10:47 UTC): category-subtotal false forcing, optional items
> polluting the plan totals, and Fix B mangling cross-table multi-year grand rows.

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

The cost-schedule feature shipped and its core works: the plan persisted a
`costSchedule` (one-time **$253,000** / ongoing-annual **$2,531,650**, server-recomputed),
both pricing docs received the AUTHORITATIVE COST SCHEDULE block, and the pure
bucket totals now match across COST_PROPOSAL and PRICE_VOLUME. Three residual
defects still make the documents disagree:

| # | Defect | Evidence (CloudWatch `auto-rfp-doc-gen-worker-Dev`, 2026-08-18 10:47 UTC) |
|---|---|---|
| **D1** | `ONGOING_ANNUAL_TOTAL_RE` (`/\bannual\b/i` …) matches **category subtotals** whose label merely contains "annual", forcing them to the grand ongoing total. Same false-correction class as the original Fix B "Total ODCs" incident. | CP: `"Total Steady-State Annual Labor (4.75 FTE Equivalent)": $1,084,200 → $2,531,650`; CP+PV: `"Total Annual ODCs"/"Total ODCs (Annual)": $262,630 → $2,531,650`. PV's labor row ("Total Steady-State Labor", no "annual") escaped → **direct cross-doc labor mismatch $2,531,650 vs $1,084,200 manufactured by our own pass**. |
| **D2** | Synthesis emitted `Real-Time Eligibility Integration Upgrade (Optional)` (ANNUAL $129,600) as a regular item; `computeCostScheduleTotals` includes it, but both documents priced optionals separately → forced totals ($2,531,650) don't equal the sum of either doc's visible base line items ($2,402,050). | Both runs: `line items diverge from the plan after forcing (docTotal=$2,402,050.00, planTotal=$2,531,650.00, delta=$129,600.00)`. $2,531,650 − $129,600 = $2,402,050 exactly. |
| **D3** | Fix B's grand-row recompute (`priorTotals` fallback in `pricing-table-math.ts`) is **table-scoped**, but multi-year grand rows aggregate totals from *previous tables*. It rewrote a correct model value down to the renewal subtotal alone. Additionally, multi-year rows are outside reconciliation scope (by design), and each doc's LLM invents its own renewal escalation → 3-/5-year totals differ across docs. | CP: `"Total 5-Year Maximum Contract Value": $12,263,250 → $4,804,100` (the correct value was ≈$12.26M; $4,804,100 is just the 2-year renewal subtotal). PV independently: `$12,163,250 → $4,764,100`. 3-year base: $7,459,150 (CP) vs $7,399,150 (PV). |

**Scope:** backend only, `packages/core` + `apps/functions`. No infra, no UI, no new routes.
Enforcement philosophy unchanged: auto-correct + warn, never fail the job — and when a
row can't be forced *safely*, skip + warn (a wrong "correction" is worse than none).

---

## 2. Design Decisions <!-- ✅ IMPLEMENTED -->

| Decision | Choice | Rationale |
|---|---|---|
| D1 remedy | **Skip** category-qualified total labels (new `CATEGORY_QUALIFIED_RE` guard), don't try to force them to per-category schedule sums | Category-level targets (Σ schedule items by category+billing) are tempting but risky: a doc may legitimately classify a cost differently than the plan (e.g. overhead as labor burden vs ODC). Two false-correction incidents in a week argue for the conservative guard. Category-level forcing can be a later iteration. |
| D1 skipped-row behavior | Push the stated value into `priorTotals` (unchanged), WARN only when the label *would previously have been forced* (matched a bucket) | Keeps grand recompute correct; avoids warn-noise on every ordinary subtotal. |
| D2 remedy | New `optional: boolean` flag on `SolutionPlanCostItemSchema` (`.catch(false).default(false)`), excluded from BOTH totals; rendered in a separate "OPTIONAL ITEMS (NOT in the totals)" section of the prompt block | Base/evaluated price and optional CLINs are priced separately in every real cost volume; the plan totals must mean "base". `.catch(false)` keeps malformed model output from failing synthesis; `.default(false)` keeps legacy schedules parsing. |
| D2 belt-and-braces | Worker normalization: `optional = optional \|\| /\boptional\b/i.test(label)` before recomputing totals | The model already writes "(Optional)" in labels today (this incident); don't depend solely on it setting the new flag. |
| D3(a) remedy | Fix B skips the `priorTotals` fallback recompute for **year-qualified** grand labels (share `YEAR_QUALIFIED_RE`, moved to `pricing-table-math.ts`) | A year-scoped grand ("Total 5-Year Maximum") typically sums period totals living in other tables; a table-local recompute produced a proven false correction. The column-sum path (data rows directly above) is untouched — "3-Year Base Period Total" over its year rows still gets corrected. |
| D3(b) remedy | Prompt-pin multi-year derivation (no code enforcement) | Escalation policy is RFP-specific; deterministic multi-year forcing stays out of scope (documented v1 limitation). New rule: every year's recurring figure = schedule `ongoingAnnualTotal` unless the RFP mandates escalation — in which case state the rate once and apply exact arithmetic; period totals = one-time + Σ years, shown as exact sums. |
| Existing plan for the test opportunity | Must be **regenerated** after deploy to pick up the `optional` exclusion (its persisted `ongoingAnnualTotal` stays $2,531,650 until then) | Totals are recomputed only at synthesis time. |

New guard regex (order of checks in `processTable`: year-qualified → **category-qualified** → money-cell count → bucket):

```ts
// A total row naming a cost category/component is a SUBTOTAL of that category,
// never the schedule's whole one-time/ongoing bucket — skip it (D1 incident:
// "Total Steady-State Annual Labor", "Total Annual ODCs" forced to the grand
// ongoing total). Phase words ("transition") are NOT categories — "Total
// One-Time Transition Costs" is a genuine bucket total and must stay forceable.
const CATEGORY_QUALIFIED_RE =
  /\blabor\b|\bODCs?\b|\bFTEs?\b|\bpersonnel\b|\bstaff(?:ing)?\b|\bmaterials?\b|\btravel\b|\bequipment\b|\bhardware\b|\bsoftware\b|\blicens\w*\b|\bsubscriptions?\b|\binfrastructure\b|\bhosting\b|\binsurance\b|\boverhead\b|\bfringe\b|\bG&A\b|\bprofit\b|\bfees?\b|\bsubcontract\w*\b|\btraining\b|\bfacilit\w*\b/i;
```

---

## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->

`packages/core/src/schemas/solution-plan.ts` — one added field on the existing item schema (line ~151):

```typescript
export const SolutionPlanCostItemSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  category: SolutionPlanCostCategorySchema.catch('OTHER').default('OTHER'),
  /** null = vendor quote required (no verified price) */
  amount: z.number().nonnegative().nullable(),
  billing: SolutionPlanCostBillingSchema,
  /** Optional/if-exercised item (option CLIN, optional upgrade) — EXCLUDED from both totals */
  optional: z.boolean().catch(false).default(false),
});
```

No other schema changes (`SolutionPlanCostScheduleSchema`, `SolutionPlanItemSchema`,
`SolutionPlanStatusPatchSchema` untouched). Legacy persisted schedules parse via the
default. Rebuild core (`pnpm --filter @auto-rfp/core build`) before dependent work.

## 4. DynamoDB Design <!-- ⏭️ SKIPPED (no changes — `optional` rides inside the existing `costSchedule` map) -->

---

## 5. Backend — Helpers & Handlers <!-- ✅ IMPLEMENTED -->

### 5.1 `apps/functions/src/helpers/cost-schedule.ts` — optional-item semantics (D2)

- `computeCostScheduleTotals` (line ~36): also `continue` when `item.optional` — optional
  items excluded from `oneTimeTotal` AND `ongoingAnnualTotal`.
- `renderCostScheduleBlock` (line ~63): split items into base vs optional. Base items render
  as today; optional items render after the TOTAL lines under
  `OPTIONAL ITEMS (NOT included in the totals — price separately if the RFP requests options):`.
  Add one usage rule: *"Optional items are NOT in the TOTAL lines. Never add them to the
  base/evaluated totals; present them as separately-priced options only when the RFP asks."*

### 5.2 Synthesis prompt + worker normalization (D2)

- `apps/functions/src/helpers/solution-plan-prompts.ts` — `buildSynthesizerSystemPrompt`
  (OUTPUT FORMAT line ~187 + COST SCHEDULE RULES ~189): add `"optional": <boolean>` to the
  item shape and a rule: *"Set `optional: true` for option CLINs, optional upgrades, and
  if-exercised scope — anything not part of the base evaluated price. Optional items are
  excluded from the totals server-side."*
- `apps/functions/src/helpers/solution-plan-worker.ts` — `processSynthesis` (schedule
  normalization before `computeCostScheduleTotals`, lines ~332–380): normalize items with
  `optional: item.optional || /\boptional\b/i.test(item.label)` (label fallback), then
  recompute totals from the normalized items and persist the normalized schedule.

### 5.3 `apps/functions/src/helpers/plan-cost-reconciliation.ts` — category guard (D1)

In `processTable` (line ~94), after the year-qualified guard (~125) and before the
money-cell-count guard: when `CATEGORY_QUALIFIED_RE.test(label)`:

- do NOT force the row (no bucket target, no grand recompute is affected — grand rows
  with category words like "Grand Total Labor" are also subtotals);
- if `classifyLabel(label)` returned a bucket (i.e. the row would previously have been
  forced), push a warning:
  `table N row "<label>": category-qualified subtotal — skipped (a category subtotal must not be forced to the plan's whole bucket total)`;
- still push the stated value into `priorTotals` (unchanged grand-recompute inputs).

Update the file-header guard list doc comment.

### 5.4 `apps/functions/src/helpers/pricing-table-math.ts` — cross-table grand mangle (D3a)

- Move `YEAR_QUALIFIED_RE` here from `plan-cost-reconciliation.ts`, export it, and re-import
  in the reconciliation helper (keeps one definition; reconciliation behavior unchanged).
- In `processTable` (~line 166, the `isGrandLabel && priorTotals.length > 0` fallback):
  skip the priorTotals recompute when `YEAR_QUALIFIED_RE.test(label)` — a year-scoped grand
  total may aggregate totals from other tables, so a table-local sum is not trustworthy.
  The `hasDataSinceLastTotal` column-sum path stays as-is.
- Update the header "Known v1 limitations" note + the `correctPricingTableTotals` doc comment.

### 5.5 `apps/functions/src/helpers/document-prompts.ts` — multi-year derivation rules (D3b)

- `buildPricingGuidanceRules(true)` (lines ~43–49): add one rule: *"Multi-year figures are
  exact arithmetic from the schedule: each contract year's recurring cost = TOTAL ONGOING
  (ANNUAL) unless the RFP mandates escalation (then state the escalation rate once and apply
  it exactly); period totals (base period, option years, total contract value) = one-time
  total + the sum of the years, computed exactly."*
- `DOC_TYPE_TASK.COST_PROPOSAL` (instruction 4b, line ~1039) and `.PRICE_VOLUME` (line ~1123):
  extend the existing schedule sentence with the same year-derivation requirement (one
  sentence each — both documents must derive multi-year tables the same way).

No changes needed in `generate-document-worker.ts` / `edit-section.ts` — both call sites
consume the shared helpers (`correctPricingTableTotals` at lines 1397/514,
`applyPlanReconciliationSafe` at lines 1412/526) and pick the fixes up automatically.

---

## 6. WebSocket Infrastructure <!-- ⏭️ SKIPPED (not applicable) -->
## 7. REST API Routes <!-- ⏭️ SKIPPED (no new routes) -->
## 8. Frontend <!-- ⏭️ SKIPPED (backend only; additive optional schema field with default — web typecheck unaffected) -->
## 9. Permissions & RBAC <!-- ⏭️ SKIPPED (no changes) -->
## 10. Email Notifications <!-- ⏭️ SKIPPED (not applicable) -->
## 11. CDK Stack Updates <!-- ⏭️ SKIPPED (no changes) -->

---

## 12. Implementation Tickets <!-- ✅ IMPLEMENTED -->

### CR-1 · Core schema: `optional` item flag (30 min) <!-- ✅ IMPLEMENTED -->
- Files: `packages/core/src/schemas/solution-plan.ts` (+ `solution-plan.test.ts`)
- Add `optional: z.boolean().catch(false).default(false)` to `SolutionPlanCostItemSchema`.
- Tests: omitted → `false`; `true` accepted; malformed (`"yes"`) → caught to `false`; legacy schedule (no flag) still parses.
- ✅ Done when: core builds; `apps/functions` + `apps/web` typecheck.

### CR-2 · cost-schedule.ts: exclude optionals + render optional section (45 min) <!-- ✅ IMPLEMENTED -->
- Files: `apps/functions/src/helpers/cost-schedule.ts` (+ `cost-schedule.test.ts`)
- §5.1. Tests: optional ANNUAL/ONE_TIME items excluded from totals (incident fixture:
  $129,600 optional → ongoing $2,402,050); optional-items section rendered with the rule
  line, absent when there are no optional items; base rendering unchanged.

### CR-3 · Synthesis prompt + optional-label normalization (45 min) <!-- ✅ IMPLEMENTED -->
- Files: `apps/functions/src/helpers/solution-plan-prompts.ts`, `helpers/solution-plan-worker.ts` (+ tests)
- §5.2. Tests: prompt mentions `optional`; worker marks a `"… (Optional)"`-labeled item
  optional and totals exclude it; explicitly-flagged items honored; persisted schedule
  carries the normalized flags.

### CR-4 · Reconciliation category-subtotal guard (1 h) <!-- ✅ IMPLEMENTED -->
- Files: `apps/functions/src/helpers/plan-cost-reconciliation.ts` (+ test)
- §5.3. Regression fixtures from the 2026-08-18 incident: `Total Steady-State Annual Labor
  (4.75 FTE Equivalent)` and `Total Annual ODCs` rows left untouched + warned;
  `Total Annual Recurring Cost` / `TOTAL ANNUAL RECURRING` / `Total One-Time Transition
  Costs` still forced; skipped subtotal's stated value still feeds a later grand recompute;
  all existing tests stay green.

### CR-5 · Fix B: skip year-qualified cross-table grand recompute (45 min) <!-- ✅ IMPLEMENTED -->
- Files: `apps/functions/src/helpers/pricing-table-math.ts`, `plan-cost-reconciliation.ts` (import move) (+ tests)
- §5.4. Regression fixture from the incident: a table with Year-4/Year-5 rows,
  `Total Renewal (2 Years)` subtotal, then `Total 5-Year Maximum Contract Value` stating
  base+renewal ($12,263,250) — the grand row must NOT be rewritten to $4,804,100. Existing
  non-year grand-after-subtotals fixture still corrected; column-sum totals still corrected.

### CR-6 · Multi-year derivation prompt rules (30 min) <!-- ✅ IMPLEMENTED -->
- Files: `apps/functions/src/helpers/document-prompts.ts` (+ existing prompt tests)
- §5.5. Tests: with-plan pricing rules mention the year-derivation rule; COST_PROPOSAL and
  PRICE_VOLUME tasks both carry it; non-pricing doc types unchanged.

**Order:** CR-1 → (CR-2, CR-3) ∥ (CR-4, CR-5) → CR-6.

---

## 13. Acceptance Criteria Checklist <!-- ✅ IMPLEMENTED -->

- [x] Category-qualified subtotal rows ("Total Annual ODCs", "Total Steady-State Annual Labor") are never forced to the plan's bucket totals; genuine bucket rows ("Total Annual Recurring Cost", "Total One-Time Transition Costs") still are.
- [x] Optional items (flag or "(Optional)" label) are excluded from both persisted schedule totals and rendered in a separate prompt-block section.
- [x] Fix B never rewrites a year-qualified grand row from table-local prior totals; in-table column sums still corrected.
- [x] Both pricing prompts pin multi-year derivation to exact schedule arithmetic.
- [x] All existing `pricing-table-math`, `plan-cost-reconciliation`, `cost-schedule`, worker and prompt tests stay green; new incident-fixture regressions added. (Three fixtures that used the label "Total Ongoing Annual Fees" were renamed to "…Costs" — "Fees" is category-qualified by the new guard, by design.)
- [x] `pnpm --filter @auto-rfp/core build && pnpm --filter @auto-rfp/core test`; `cd apps/functions && pnpm test && pnpm build`; `cd apps/web && npx tsc --noEmit` — all pass. (Pre-existing failures unrelated to this change: two functions suites can't resolve the `fast-check` dev dep in this environment, and the web tsc baseline already had 1278 errors before this change — both identical on HEAD.)

## Verification (end-to-end, dev stage)

1. Run the build/test chain above, deploy (`pnpm deploy:dev:hotswap`).
2. On opportunity `b4ac1b8e-b882-4775-9ce3-1b37049e7876`: **regenerate the Solution Plan**
   (required — the persisted totals still include the optional item until synthesis reruns);
   confirm in DynamoDB (`RFP-table-Dev`, PK `SOLUTION_PLAN`) that the optional item carries
   `optional: true` and `ongoingAnnualTotal` = $2,402,050-class base figure (excludes it).
3. Regenerate COST_PROPOSAL and PRICE_VOLUME. Expect in both:
   one-time and ongoing-annual totals equal the plan's and each other's; labor/ODC subtotals
   equal their own line items (NOT the grand total); 3-year and 5-year totals identical
   across the two documents.
4. CloudWatch `auto-rfp-doc-gen-worker-Dev`: no forced category subtotals; no
   `line items diverge` delta equal to the optional amount; no Fix B correction on
   year-qualified grand rows; any remaining reconciliation warnings are genuine.

## 14. Summary of New Files <!-- ✅ IMPLEMENTED -->

No new files — all six tickets modify existing helpers/schemas and their co-located tests.

## Known limitations (accepted, carried forward)

- Multi-year totals remain prompt-governed (no deterministic forcing) — escalation policy is RFP-specific.
- Category subtotals are skipped, not verified against per-category schedule sums (possible later iteration).
- User-edited plans still clear the schedule (Fix A fallback until regenerated).
