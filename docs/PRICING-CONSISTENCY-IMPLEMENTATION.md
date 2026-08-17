# Pricing Consistency — Implementation Document

> Fixes for inconsistent pricing across generated Cost Proposal / Price Volume documents.
> Investigated on opportunity `25c72a7e-f3ea-4a72-a5a3-7b132070e7f3` (2026-08-17).

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Problem 1** | Cost Proposal and Price Volume generated for the same opportunity report different "ongoing fees" totals ($4,356 vs $5,235) because each document's LLM run independently invents its own service stack and prices. |
| **Problem 2** | LLM-computed sums are wrong (e.g. "Plugin Licenses $866" vs component prices summing to $867.80; "2 hrs/mo × 12 × $105/hr = $2,280" instead of $2,520). |
| **Problem 3** | Pricing documents were generated against a Solution Plan whose decision was NO-BID ("No ROM will be submitted") — the gate only checks that a READY plan *exists*. |
| **Fix A** | **Plan as single price source** — when an approved Solution Plan exists, withhold the `search_service_pricing` tool from COST_PROPOSAL / PRICE_VOLUME generation and require documents to copy the plan's "Selected Services & Licenses" prices verbatim. Source URLs stay in the plan only — customer-facing pricing documents no longer print them. |
| **Fix B** | **Deterministic totals validation** — post-generation pass that parses pricing tables, recomputes column totals, and **auto-corrects** mismatched total cells before saving. |
| **Fix C** | ~~NO-BID gate~~ **REMOVED by product decision (2026-08-17)**: the Solution Plan does not make bid/no-bid decisions and never blocks generation on one. Only Fixes A and B ship. |
| **Packages touched** | `packages/core`, `apps/functions`, `apps/web` |
| **Infra changes** | None (no new Lambdas, routes, tables, or stacks) |

Out of scope (deliberately): target-solicitation picker for bundled opportunities; extended-price (`qty × unit`) verification (v2 candidate — see §5.3 limitations).

---

## 2. Architecture Overview <!-- ✅ IMPLEMENTED -->

```
                       ┌────────────────────────────────┐
                       │  Solution Plan generation       │
                       │  (grilling → synthesis)         │
                       │  • search_service_pricing HERE  │  (already exists)
                       │  • emits bidDecision BID/NO_BID │  (Fix C — new)
                       │  • "Selected Services &         │
                       │     Licenses" priced table      │  (already exists)
                       └───────────────┬────────────────┘
                                       │ READY plan (source of truth)
                     ┌─────────────────┼──────────────────┐
                     ▼                 ▼                  ▼
              generate-document   solution-plan-gate   document prompts
              handler (409 on     • status READY?      • plan present →
              NO_BID — Fix C)     • bidDecision        copy plan rows
                                    NO_BID? → block    verbatim, NO tool
                                                        (Fix A)
                     ▼
              generate-document-worker
              • getDocumentToolsForType(type, {hasSolutionPlan})
                → search_service_pricing withheld when plan exists (Fix A)
              • Step 7: correctPricingTableTotals(html)
                → recompute + auto-fix table totals (Fix B)
```

| Decision | Choice | Rationale |
|---|---|---|
| Tool removal | **Conditional** (withheld only when a plan was loaded) | Orgs with `enableSolutionPlan` off, the stage kill switch, and ADR-10 grandfathered docs still generate pricing docs without a plan — the tool must remain their only price source. |
| Missing service in plan | Document writes `vendor quote required — not in Approved Solution Plan` | Surfaces the gap in one place; fixing the plan fixes all documents. Never a fresh lookup, never an invented price. |
| Source URLs | **Plan only** — pricing documents drop the `Source (URL + retrieval date)` column entirely | Source citations are internal traceability; they don't belong in a customer-facing volume. Auditability is preserved because every document is stamped with `solutionPlanId`/`solutionPlanVersion` (ADR-7) and the plan carries the sources. |
| Math mismatch handling | **Auto-correct** the total cell, log the correction | Deterministic repair; document is always internally consistent. |
| `bidDecision` on legacy plans | Absent → treated as `BID` (gate stays open) | Backward compatible; only newly synthesized plans carry the field. |
| NO_BID blocks | **All gated document types**, not just pricing | Generating a technical proposal for a no-bid opportunity is equally wrong. |

---

## 3. Data Models & Zod Schemas <!-- ⏭️ SKIPPED (Fix C removed by product decision — the Solution Plan does not decide bid/no-bid) -->

All changes in `packages/core/src/schemas/solution-plan.ts` (existing file — no new schema file, no new entity).

```typescript
// ─── Bid decision (Fix C) ───
export const SolutionPlanBidDecisionSchema = z.enum(['BID', 'NO_BID']);
export type SolutionPlanBidDecision = z.infer<typeof SolutionPlanBidDecisionSchema>;

/** Human-readable labels for the bid decision badge. */
export const SOLUTION_PLAN_BID_DECISION_LABELS: Record<SolutionPlanBidDecision, string> = {
  BID: 'Bid',
  NO_BID: 'No-Bid',
};

// ─── SolutionPlanItemSchema — add one field ───
export const SolutionPlanItemSchema = SolutionPlanCreateRequestSchema.extend({
  // ...existing fields unchanged...
  /**
   * Structured go/no-go decision emitted by synthesis (Fix C). Absent on plans
   * synthesized before this feature — treated as 'BID' by the generation gate.
   */
  bidDecision: SolutionPlanBidDecisionSchema.optional(),
});

// ─── Error codes — add one value ───
export const SolutionPlanErrorCodeSchema = z.enum([
  'SOLUTION_PLAN_NOT_READY',
  'SOLUTION_PLAN_CONFLICT',
  'SOLUTION_PLAN_RUN_IN_PROGRESS',
  'SOLUTION_PLAN_REQUIRED',
  'SOLUTION_PLAN_NO_BID',        // NEW — gated generation refused: plan decision is NO_BID
]);
```

Also extend the gate result (lives in `apps/functions/src/helpers/solution-plan-gate.ts`, already Zod):

```typescript
export const SolutionPlanGateResultSchema = z.object({
  allowed: z.boolean(),
  solutionPlanStatus: SolutionPlanStatusSchema.nullable(),
  /** Set when allowed=false; distinguishes "no plan" from "plan says NO_BID". */
  code: SolutionPlanErrorCodeSchema.optional(),
});
```

> After schema changes: `pnpm --filter @auto-rfp/core build`, then run schema tests (`packages/core`: vitest) and dependent typechecks.

---

## 4. DynamoDB Design <!-- ⏭️ SKIPPED (Fix C removed by product decision — the Solution Plan does not decide bid/no-bid) -->

No new partitions, SKs, GSIs, or TTLs. One new **attribute** on the existing `SOLUTION_PLAN` item: `bidDecision` (string, optional), written by the synthesis step through the existing plan update helper in `apps/functions/src/helpers/solution-plan.ts`. No migration needed — absent means `BID`.

---

## 5. Backend — Helpers & Handlers <!-- ✅ IMPLEMENTED -->

### 5.1 Fix C — `bidDecision` from synthesis + gate check

**`apps/functions/src/helpers/solution-plan-prompts.ts`** — `buildSynthesizerSystemPrompt`:

- Output format becomes:
  `{"title": "...", "bidDecision": "BID" | "NO_BID", "htmlContent": "..."}`
- Add content rule:
  `- bidDecision: output "NO_BID" ONLY when the transcript's final resolution is not to submit a proposal (no-bid / no ROM / decline). Otherwise output "BID".`

**`apps/functions/src/helpers/solution-plan-worker.ts`**:

```typescript
const SynthesisResponseSchema = z.object({
  title: z.string().min(1),
  bidDecision: SolutionPlanBidDecisionSchema.default('BID'), // default guards model omission
  htmlContent: z.string().min(1),
});
```

Persist `bidDecision` in the same plan update that writes `contentKey`/`version`/`status: 'READY'` (around `solution-plan-worker.ts:333-362`).

**`apps/functions/src/helpers/solution-plan-gate.ts`** — `checkSolutionPlanGate` (line 91): after the READY check, block on NO_BID:

```typescript
const plan = await getSolutionPlanByOpportunity({ orgId, projectId, opportunityId });
const solutionPlanStatus = plan?.status ?? null;
if (solutionPlanStatus === 'READY') {
  if (plan?.bidDecision === 'NO_BID') {
    return { allowed: false, solutionPlanStatus, code: 'SOLUTION_PLAN_NO_BID' };
  }
  return { allowed: true, solutionPlanStatus };
}
```

> Note: NO_BID must **not** fall through to the ADR-10 grandfathering check — an explicit NO_BID decision outranks "a gated document already exists".

**`apps/functions/src/handlers/rfp-document/generate-document.ts`** (line 98-111) — branch the 409 on the returned code:

```typescript
const { allowed, solutionPlanStatus, code } = await checkSolutionPlanGate({ ... });
if (!allowed) {
  return apiResponse(409, code === 'SOLUTION_PLAN_NO_BID'
    ? {
        message: 'The Solution Plan for this opportunity is a NO-BID decision — document generation is blocked. Regenerate the Solution Plan if the decision has changed.',
        code,
        solutionPlanStatus,
      }
    : {
        message: 'A ready Solution Plan is required before generating this document type. Create a Solution Plan for this opportunity first.',
        code: 'SOLUTION_PLAN_REQUIRED',
        solutionPlanStatus,
      });
}
```

### 5.2 Fix A — plan as the single third-party price source

**`apps/functions/src/helpers/document-tools.ts`** — `getDocumentToolsForType` (line 289) gains an options param:

```typescript
export const getDocumentToolsForType = (
  documentType: RFPDocumentType,
  opts?: { hasSolutionPlan?: boolean },
) =>
  DOCUMENT_TOOLS.filter((tool) => {
    if (tool.name !== 'search_service_pricing') return true;
    if (!PRICING_TOOL_DOC_TYPES.has(documentType)) return false;
    // Plan present → the plan's Selected Services & Licenses table is the only
    // allowed third-party price source; no live lookups (ADR: pricing single source).
    return !opts?.hasSolutionPlan;
  });
```

Export `PRICING_TOOL_DOC_TYPES` (currently module-private) — the worker's math-validation hook (§5.3) needs it.

**Call sites** (thread the flag):

| File | Change |
|---|---|
| `apps/functions/src/helpers/generate-document-worker.ts:732` | `getDocumentToolsForType(documentType, { hasSolutionPlan: Boolean(solutionPlanContext) })` — `solutionPlanContext` is already in scope (loaded at line 1046 and passed down). |
| `apps/functions/src/helpers/document-section-generator.ts:348` | Add `hasSolutionPlan: boolean` to the generator's args (the worker already passes `initialUserPrompt` containing the plan; pass the flag alongside) and forward to `getDocumentToolsForType`. |
| `apps/functions/src/handlers/rfp-document/edit-section.ts:330` | The document record is already loaded in this handler; derive the flag from the ADR-7 stamp: `{ hasSolutionPlan: Boolean(document.solutionPlanId) }`. |

**`apps/functions/src/helpers/document-prompts.ts`** — split `PRICING_GUIDANCE_RULES` (line 12) into two variants and select in `buildPricingRulesBlock(documentType, hasSolutionPlan)`:

Plan-present variant (replaces the THIRD-PARTY PRICING block):

```
THIRD-PARTY PRICING (subscriptions, licenses, SaaS, cloud services):
- The Approved Solution Plan's "Selected Services & Licenses" table is the ONLY source of third-party prices
- Copy each service's price data VERBATIM: service, tier/plan, unit price, billing period
- Do NOT include source URLs or retrieval dates in this document — sources live in the Solution Plan
- ONE row per service — NEVER bundle multiple services into a single priced row
- A service not listed in the Approved Solution Plan gets "vendor quote required — not in Approved Solution Plan" — never look up or invent a price
- Every third-party price stays labeled as an ESTIMATE subject to vendor quote
```

Plan-absent variant: current `search_service_pricing` instructions, with the citation rule changed the same way — prices still come from the tool, but the document must NOT print source URLs or retrieval dates (only the ESTIMATE label). The current line "Every third-party price MUST cite its source URL and retrieval date" is removed in both variants.

**`document-prompts.ts` — `DOC_TYPE_GUIDANCE` for `PRICE_VOLUME` (line ~555) and `COST_PROPOSAL` (line ~597), section "5. Third-Party Services & Subscriptions":**

- Table columns become: `Service | Tier/Plan | Unit Price | Billing Period | Quantity | Extended Price` — the `Source (URL + retrieval date)` column is removed.
- Keep: "Label every price as an ESTIMATE subject to vendor quote" and the "vendor quote required" rule.
- Remove any instruction to add a sources/footnotes list (the incident documents rendered a "Third-Party Pricing Sources" footnote block — the new rules must not ask for one).

The Solution Plan side is **unchanged**: the synthesizer's "Selected Services & Licenses" table keeps its `Source` column (`solution-plan-prompts.ts:179`) — that is where price provenance lives.

`buildSystemPromptForDocumentType` gains the `hasSolutionPlan` flag (threaded from the worker, which builds the system prompt at line 1100 right after loading `solutionPlanContext`).

### 5.3 Fix B — deterministic totals validation (auto-correct)

**New helper `apps/functions/src/helpers/pricing-table-math.ts`:**

```typescript
export interface TotalCorrection {
  tableIndex: number;
  rowLabel: string;
  previousValue: string;  // e.g. "$5,235"
  correctedValue: string; // e.g. "$5,245.00"
}

export interface PricingMathResult {
  html: string;
  corrections: TotalCorrection[];
}

/**
 * Parse every <table> in the HTML; for each row whose first cell matches
 * /\btotal\b/i, recompute the money value as the sum of the money cells in the
 * same column position across the non-total rows since the previous total row
 * (or table start). If |stated − computed| > $1.00, rewrite the cell with the
 * computed value (formatted to match the row's existing style: keep cents only
 * if the source rows carry cents). Rows/tables without money cells are skipped.
 */
export const correctPricingTableTotals = (html: string): PricingMathResult => { ... };
```

Implementation notes:

- Money regex: `/\$\s?([\d,]+(?:\.\d{1,2})?)/` — take the **last** money match in a cell (labels like "(2 hrs × $105/hr)" precede the value).
- Regex/string-based table walking is sufficient (generated HTML is well-formed `<table><tr><td>`); no HTML parser dependency — mirrors existing patterns in `compliance-review-html.ts`.
- "Since the previous total row" handles tables with subtotal + grand-total sections; a grand-total row (label matches /grand|overall/i **or** is the last total row) sums the *subtotal* rows instead when subtotals exist.
- Pure function, no I/O — trivially unit-testable.

**Hook — `apps/functions/src/helpers/generate-document-worker.ts`, Step 7 (before the S3 upload at line 1397):**

```typescript
if (PRICING_TOOL_DOC_TYPES.has(documentType)) {
  const { html: correctedHtml, corrections } = correctPricingTableTotals(htmlContent);
  if (corrections.length > 0) {
    console.warn(
      `[worker] Pricing math auto-corrected ${corrections.length} total(s) for documentId=${documentId}:`,
      corrections.map((c) => `"${c.rowLabel}": ${c.previousValue} → ${c.correctedValue}`).join('; '),
    );
    htmlContent = correctedHtml;  // htmlContent becomes `let`
  }
}
```

Also apply in `edit-section.ts` for pricing document types after a section regeneration (same helper, same guard).

**Known limitations (documented, accepted for v1):**

- Only column totals are verified. Formula-in-label errors ("2 hrs/mo × 12 × $105/hr = $2,280") and `qty × unit = extended` mismatches are not recomputed — largely mitigated by Fix A (per-service plan rows, no bundling) and internal rates coming from `get_pricing_data`.
- The incident's "$866 bundled row" is prevented by the new "ONE row per service — never bundle" prompt rule plus verbatim plan-row copying, and the table total above it is then verified by this pass.

---

## 6. WebSocket Infrastructure <!-- ⏭️ SKIPPED (not applicable) -->

None.

## 7. REST API Routes <!-- ⏭️ SKIPPED (no new routes) -->

No new routes. `POST` generate-document response gains the `SOLUTION_PLAN_NO_BID` 409 body variant (§5.1) — same route, same auth.

---

## 8. Frontend — Hooks & Components <!-- ⏭️ SKIPPED (Fix C removed by product decision — the Solution Plan does not decide bid/no-bid) -->

Minimal changes, all in existing files:

| File | Change |
|---|---|
| `apps/web/lib/hooks/use-rfp-documents.ts` | `SolutionPlanRequiredBodySchema` (line ~368) accepts `code: 'SOLUTION_PLAN_REQUIRED' \| 'SOLUTION_PLAN_NO_BID'`. Add a `SOLUTION_PLAN_NO_BID` message constant ("The Solution Plan for this opportunity is a No-Bid decision — generation is blocked."). `SolutionPlanRequiredError` carries the `code` so the callout can branch. |
| `apps/web/features/solution-plan/components/SolutionPlanGateCallout.tsx` | When the error code is `SOLUTION_PLAN_NO_BID`, render the no-bid explanation with a link to the Solution Plan editor (regenerate/edit), instead of the "create a plan" CTA. |
| `apps/web/features/solution-plan/components/SolutionPlanStatusBadge.tsx` (or `SolutionPlanPanel.tsx`) | Show a `No-Bid` badge (destructive variant) next to the READY status when `plan.bidDecision === 'NO_BID'`, using `SOLUTION_PLAN_BID_DECISION_LABELS`. |

No new pages, hooks, or feature modules. Loading states unaffected.

---

## 9. Permissions & RBAC <!-- ⏭️ SKIPPED (no changes) -->

No new permissions; all touched routes keep their existing middleware stacks.

## 10. Email Notifications <!-- ⏭️ SKIPPED (not applicable) -->

None.

## 11. CDK Stack Updates <!-- ⏭️ SKIPPED (no changes) -->

None — no new Lambdas, queues, tables, env vars, or IAM permissions.

---

## 12. Implementation Tickets <!-- ✅ IMPLEMENTED -->

### PC-1 · Core schema: `bidDecision` + error code (30 min) <!-- ⏭️ SKIPPED (Fix C removed by product decision — the Solution Plan does not decide bid/no-bid) -->
- Files: `packages/core/src/schemas/solution-plan.ts` (+ its vitest file)
- Add `SolutionPlanBidDecisionSchema`, labels, `bidDecision` on `SolutionPlanItemSchema`, `SOLUTION_PLAN_NO_BID` error code.
- Tests: enum validation, optional field omission, labels completeness.
- Rebuild core: `pnpm --filter @auto-rfp/core build`.
- ✅ Done when: core builds; `apps/functions` and `apps/web` typecheck.

### PC-2 · Synthesis emits & persists `bidDecision` (1 h) <!-- ⏭️ SKIPPED (Fix C removed by product decision — the Solution Plan does not decide bid/no-bid) -->
- Files: `helpers/solution-plan-prompts.ts`, `helpers/solution-plan-worker.ts` (+ both test files)
- Synthesizer prompt outputs `bidDecision`; `SynthesisResponseSchema` validates with `.default('BID')`; persisted with the READY update.
- Tests: prompt contains the rule; worker persists `NO_BID`; missing field defaults to `BID`.

### PC-3 · Gate blocks NO_BID + handler 409 (1 h) <!-- ⏭️ SKIPPED (Fix C removed by product decision — the Solution Plan does not decide bid/no-bid) -->
- Files: `helpers/solution-plan-gate.ts`, `handlers/rfp-document/generate-document.ts` (+ both test files)
- Gate returns `{ allowed: false, code: 'SOLUTION_PLAN_NO_BID' }` for READY+NO_BID plans **before** grandfathering; handler branches the 409 body.
- Tests: NO_BID blocked (grandfathered docs do NOT open it), BID allowed, legacy plan (no field) allowed, exempt doc types unaffected, kill switch still bypasses.

### PC-4 · Conditional pricing tool + prompt rules (2 h) <!-- ✅ IMPLEMENTED -->
- Files: `helpers/document-tools.ts`, `helpers/document-prompts.ts`, `helpers/generate-document-worker.ts`, `helpers/document-section-generator.ts`, `handlers/rfp-document/edit-section.ts` (+ their test files)
- `getDocumentToolsForType(type, { hasSolutionPlan })`; export `PRICING_TOOL_DOC_TYPES`; plan-present prompt variant ("copy plan prices verbatim / one row per service / vendor quote required — not in Approved Solution Plan"); thread the flag through all three call sites.
- Remove source URLs from pricing documents (both variants + `DOC_TYPE_GUIDANCE` §5 table columns for COST_PROPOSAL and PRICE_VOLUME); Solution Plan synthesizer keeps its `Source` column.
- Tests: tool present without plan, absent with plan, never present for non-pricing types; prompt variant selection; prompts contain no "cite its source URL" instruction and no `Source` column for pricing types; edit-section derives flag from `document.solutionPlanId`.

### PC-5 · `pricing-table-math.ts` validator + worker hook (3 h) <!-- ✅ IMPLEMENTED -->
- Files: `helpers/pricing-table-math.ts` (NEW), `helpers/pricing-table-math.test.ts` (NEW), `helpers/generate-document-worker.ts`, `handlers/rfp-document/edit-section.ts`
- Pure `correctPricingTableTotals`; hooked before S3 upload for pricing doc types only; corrections logged.
- Tests (validator): correct total untouched; wrong total rewritten (the $866 table from the incident as a fixture); subtotal+grand-total tables; $1 tolerance; cells with formula labels; tables without totals; non-money tables; malformed HTML passthrough. Tests (worker): hook applied only for COST_PROPOSAL/PRICE_VOLUME.

### PC-6 · Frontend: NO_BID handling + badge (1.5 h) <!-- ⏭️ SKIPPED (Fix C removed by product decision — the Solution Plan does not decide bid/no-bid) -->
- Files: `lib/hooks/use-rfp-documents.ts`, `features/solution-plan/components/SolutionPlanGateCallout.tsx`, `features/solution-plan/components/SolutionPlanStatusBadge.tsx` (+ `__tests__`)
- Parse the new 409 code, branch the callout copy, render the No-Bid badge.
- Tests: 409 body parsing for both codes; callout renders no-bid variant; badge shows for `NO_BID`, hidden otherwise.

**Order:** PC-1 → PC-2 → PC-3 (Fix C chain), PC-4 (Fix A), PC-5 (Fix B) — PC-4 and PC-5 are independent of the Fix C chain after PC-1; PC-6 last.

---

## 13. Acceptance Criteria Checklist <!-- ✅ IMPLEMENTED -->

- [ ] Newly synthesized Solution Plans carry `bidDecision`; a no-bid transcript produces `NO_BID`.
- [ ] Generating any gated document type against a READY `NO_BID` plan returns 409 `SOLUTION_PLAN_NO_BID` (grandfathering does not override), and the UI explains why.
- [ ] Plans without `bidDecision` (legacy) keep generating documents as before.
- [ ] When an approved plan exists, COST_PROPOSAL / PRICE_VOLUME generation offers **no** `search_service_pricing` tool, and the prompt instructs verbatim copying of the plan's price table with one service per row.
- [ ] When no plan exists (org flag off / kill switch / grandfathered), the pricing tool is still offered — behavior unchanged.
- [ ] A service missing from the plan renders "vendor quote required — not in Approved Solution Plan" (verified in a generated dev document).
- [ ] Generated Cost Proposal / Price Volume documents contain **no source URLs or retrieval dates** for third-party prices (no `Source` column, no sources footnote); the Solution Plan's "Selected Services & Licenses" table still carries them.
- [ ] Pricing-table total mismatches are auto-corrected before save and logged with before/after values; non-pricing document types are untouched.
- [ ] Regenerating both pricing documents for a test opportunity with a proper BID plan yields identical third-party rows and matching ongoing-fee totals across the two documents.
- [ ] `pnpm tsc --noEmit` passes in `packages/core`, `apps/functions`, `apps/web`; all new/updated Jest + vitest suites pass.

---

## 14. Summary of New Files <!-- ✅ IMPLEMENTED -->

| File | Purpose | Status |
|---|---|---|
| `apps/functions/src/helpers/pricing-table-math.ts` | Pure pricing-table parser + total auto-correction | ✅ |
| `apps/functions/src/helpers/pricing-table-math.test.ts` | Validator unit tests (incident tables as fixtures) | ✅ |

All other changes modify existing files (listed per ticket in §12).

---

## Verification (end-to-end, dev stage)

1. `pnpm --filter @auto-rfp/core build` → `cd apps/functions && pnpm test && pnpm build` → `cd apps/web && pnpm test && npx tsc --noEmit`.
2. Deploy to dev (`pnpm deploy:dev:hotswap` for Lambda-only iteration).
3. On a test opportunity: regenerate the Solution Plan → confirm `bidDecision` persisted; with a NO_BID plan attempt Cost Proposal generation → expect 409 + UI callout.
4. With a BID plan containing a priced services table, generate Cost Proposal **and** Price Volume → diff their third-party tables (must match row-for-row, prices identical to the plan, no source URLs anywhere) and verify every table total by hand.
5. Check CloudWatch worker logs for `Pricing math auto-corrected` entries to confirm the validator ran.
