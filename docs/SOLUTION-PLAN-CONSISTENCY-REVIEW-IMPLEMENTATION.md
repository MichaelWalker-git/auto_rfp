# Solution-Plan Consistency Compliance Review — Implementation Plan <!-- ✅ IMPLEMENTED -->

> Extends AI Compliance Review to verify the submission package is **true to the
> latest solution plan** — same approach, team, prices, services — not only that it
> is solicitation-compliant and true to the company's own facts.
>
> **This is a direct sibling of the factual-accuracy review** (see
> `docs/FACTUAL-ACCURACY-REVIEW-IMPLEMENTATION.md`, checks C1–C5). It reuses the
> SAME two-stage pipeline, the SAME augmenter seam, and the SAME validation path.
> Read that plan first — this document only describes the new check ("C6") and its
> one new source of truth (the solution plan). Do NOT reinvent the pipeline.

---

## 0. TL;DR for the implementing agent

- **One new check, "C6"**, added as a best-effort `FindingAugmenter` to
  `runFullReview` — exactly like C1–C5. Fail-open (`try/catch → []`); a
  solution-plan outage must NEVER fail a review.
- **One new source of truth:** the opportunity's single READY solution plan,
  loaded via `loadApprovedSolutionPlanContext({ orgId, projectId, opportunityId })`.
  It has **three shapes**, and the check treats them separately:
  - **Structured `costSchedule`** (`items[]` — `label`/`amount`/`billing`/`category`)
    → **deterministic** price/service checks (the crisp, high-confidence slice).
  - **Prose HTML** (6 fixed `<h2>` sections — Solution Architecture, Selected
    Services & Licenses, Timeline & Phases, Team Composition, Key Risks, Cost
    Drivers & Assumptions) → **model contradiction** check (like C3).
  - **Structured `planTeam`** (`members[]` — `role` → assigned person `nameSnapshot`)
    → **deterministic** staffing checks (C6c + C6d). ⚠️ **The roster is a plan SIDECAR
    written AFTER synthesis — it is NOT in the prose HTML above.** The
    `attachGeneratedTeam` hook runs `generateTeamRecommendation` and writes
    `planTeam` via `updateItem` *after* the plan HTML is uploaded; synthesis itself
    only emits `{ title, htmlContent, costSchedule }`. So the plan prose (C6b) never
    reliably contains the assigned people — team consistency needs its own
    structured check against `planTeam`, exactly as prices need C6a against
    `costSchedule`. Team consistency has **two directions**, each its own sub-check:
    **C6c** = a plan ROLE staffed by a DIFFERENT PERSON; **C6d** = the SAME plan
    PERSON listed under a DIFFERENT ROLE. Neither implies the other — a package edit
    that only relabels an existing person's role (very common: doc generation restates
    titles) trips C6d, never C6c.
- **1 new issue type:** `SOLUTION_PLAN_MISMATCH` (its own UI label/filter, distinct
  from `FACTUAL_INACCURACY` — the solution plan is the *win strategy*, a different
  source of truth with a different owner than company facts). **Two-enum edit**
  (see §3) — the trap the factual-accuracy memory warns about.
- **Coverage decision (v1): CONTRADICTIONS ONLY.** Flag where the package states a
  DIFFERENT price/billing/team/approach/service than the plan. Do NOT flag
  "missing" or "extra" services — package prose rarely enumerates services the way
  the schedule does, so a coverage diff over-flags. (Deferred; see §9.)
- **Source-of-truth decision: latest READY plan, even if `isStale`.** Mirrors
  document generation (`loadApprovedSolutionPlanContext` injects stale-but-READY
  plans). The latest plan is the reference; a stale plan still runs the check.
- **No new infra.** Reuse the worker Lambda, DynamoDB, S3.
- **Instrument** exactly like the others:
  `console.log(JSON.stringify({tag:'factual-candidates', factType:'C6-solution-plan', generated, kept}))`.

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Trigger modes** | Full review (async worker). Chat: fold the plan into `verify_company_facts` (optional, §8). |
| **Source of truth** | The opportunity's single READY solution plan (prose text + structured `costSchedule` + structured `planTeam`) |
| **New finding type** | `SOLUTION_PLAN_MISMATCH` (severity `major`) |
| **Design stance** | Fact-anchored, two-stage (deterministic candidates → model verify), best-effort/fail-open, instrumented |
| **Coverage (v1)** | Contradictions only (price/billing/staffing/role/approach). No missing/extra-service diff, no open-role/unstaffed diff. |
| **Staleness** | Latest READY plan used even when `isStale` — matches doc generation |
| **New infra** | None |
| **Packages touched** | `packages/core`, `apps/functions`; `apps/web` (labels only) |

### What exists today (READ FIRST — do not rebuild)

| File | Role | Reuse for |
|---|---|---|
| `apps/functions/src/helpers/compliance-review-engine.ts` | `runFullReview` has the `augmentFindings` seam; `RawFindingSchema` enum | Wire C6 here (§7); extend `RawFindingSchema` enum + `SYSTEM_PROMPT` |
| `apps/functions/src/helpers/compliance-review-pastperf.ts` | **The closest reference** — deterministic candidate scan → ONE batched model verify against retrieved records | Copy this shape for C6's price/service checks |
| `apps/functions/src/helpers/compliance-review-kb-contradiction.ts` | Section-chunked prose-contradiction (HTML docs → batched model call) | Copy this shape for C6's prose-vs-plan contradiction |
| `apps/functions/src/helpers/compliance-review-consistency.ts` | `computeProfileFactFindings` — canonical-value-vs-package two-stage | Reference for the deterministic price/label matcher |
| `apps/functions/src/helpers/compliance-truth-sources.ts` | Best-effort truth-source access layer (all `null`/`[]` on error) | ADD `loadSolutionPlanFacts` here (§4) |
| `apps/functions/src/helpers/compliance-review-html.ts` | `stripHtml`, `splitIntoSections`, `getSectionText` | Scan package doc/questionnaire/form text |
| `apps/functions/src/helpers/compliance-review-validate.ts` | `validateAndTagFindings` — anchor validation + fingerprint + dedup | All C6 findings flow through it (unchanged) |
| `apps/functions/src/constants/compliance-review.ts` | Factual bounds (`MAX_FACTUAL_CANDIDATES_PER_CHECK`, `MAX_TOKENS_FACTUAL`, …) | Reuse; add C6-specific bounds if needed (§10) |

### The solution-plan source of truth (READ — this is the only new dependency)

| Symbol | File | Signature / shape |
|---|---|---|
| `loadApprovedSolutionPlanContext` | `apps/functions/src/helpers/generate-document-worker.ts:934` | `(key: SolutionPlanKey) => Promise<{ plan: SolutionPlanDBItem; text: string } \| null>` — returns null unless status READY; loads HTML → `stripHtmlToText` → truncated. **A stale-but-READY plan IS returned.** |
| `getSolutionPlanByOpportunity` | `apps/functions/src/helpers/solution-plan.ts:69` | `(key: SolutionPlanKey) => Promise<SolutionPlanDBItem \| null>` — the raw record (fallback if you don't want the doc-worker's text budget) |
| `SolutionPlanKey` | `packages/core/src/schemas/solution-plan.ts:52` | `{ orgId, projectId, opportunityId }` — ONE plan per opportunity; "latest" = this single record |
| `costSchedule` (on the plan) | `packages/core/src/schemas/solution-plan.ts:170` | `{ currency, items: { label, description?, category, amount: number\|null, billing, optional }[], oneTimeTotal, ongoingAnnualTotal, assumptions? } \| null` |
| `SolutionPlanCostItem` | `packages/core/src/schemas/solution-plan.ts:151` | `label` · `amount` (nullable; null = vendor-quote-required) · `billing` (`ONE_TIME`/`MONTHLY`/`ANNUAL`) · `category` (`LABOR`/`THIRD_PARTY`/`ODC`/`OTHER`) · `optional` (excluded from totals) |
| `planTeam` (on the plan) | `packages/core/src/schemas/solution-plan.ts:344` | `{ members: PlanTeamMember[], userModified, generatedAt?, savedAt? } \| null` — the recommended/edited team, embedded on the plan (ADR-002, the `costSchedule` precedent). Written by `attachGeneratedTeam` AFTER synthesis, NOT part of the plan HTML. |
| `PlanTeamMember` | `packages/core/src/schemas/solution-plan.ts:202` | Three shapes: **FILLED** (`employeeId` + `nameSnapshot` + `role`), **DELETED-employee** (`nameSnapshot` + `removedEmployee:true`, no `employeeId`), **UNFILLED** (`role` only). Only FILLED lines carry a checkable "role → person" assignment. |

> **Important:** the plan's approach/services are NOT structured Zod fields — they
> are HTML `<h2>` prose sections; only `costSchedule` and `planTeam` are
> machine-readable. That is why C6 splits into a deterministic cost-schedule check
> (C6a), a model prose-contradiction check (C6b), and two deterministic team-roster
> checks — role→person (C6c) and person→role (C6d).
>
> **The team trap (why C6c exists):** "Team Composition" *is* one of the plan's
> `<h2>` prose sections, so it is tempting to assume C6b covers the team. It does
> NOT. The synthesizer emits only `{ title, htmlContent, costSchedule }` — no team.
> The recommended people are produced by a SEPARATE step (`generateTeamRecommendation`)
> and written to the `planTeam` sidecar via `updateItem` *after* the HTML is stored;
> that step never rewrites the HTML. So the assigned people/roles are essentially
> never in the plan prose C6b reads. Team-as-assigned is checkable ONLY against the
> structured `planTeam` — hence C6c mirrors C6a (structured source → deterministic
> candidate scan → batched verify), not C6b.

### Where the check plugs in

```
runFullReview (worker, Sonnet, 15-min, no 29s limit)
  └─ augmentFindings: Promise.all([
        computeMissingFormFindings,          // EXISTS
        computeConsistencyFindings,          // EXISTS
        computeProfileFactFindings,          // C1
        computeCertFindings,                 // C2
        computeKbContradictionFindings,      // C3
        computePastPerfValueFindings,        // C4
        computeNdaLeakFindings,              // C5
        computeSolutionPlanFindings,         // C6 (C6a cost + C6b prose + C6c role→person + C6d person→role)  ← needs orgId, projectId, oppId, modelId, inventory
     ])   // ALL best-effort → [] on failure; ALL flow through validateAndTagFindings
```

---

## 2. The two-stage pipeline (SAME as C1–C5) <!-- ✅ IMPLEMENTED -->

No new pipeline. C6 is three sub-checks, each an instance of the established shape:

```
C6a — COST-SCHEDULE consistency  (deterministic candidates → ONE batched model verify)
  Stage 1: for each plan cost item with a concrete amount, scan the package for a
    passage/field/cell that mentions that service label AND carries a formatted
    price. Loose = high recall (over-flag is fine).
  Stage 2: ONE batched model call — [{ serviceLabel, planAmount, planBilling,
    packageSnippet, statedPrice }] → keep only genuine SAME-service price/billing
    contradictions. Emit SOLUTION_PLAN_MISMATCH / major.

C6b — PROSE contradiction  (section-chunked → ONE batched model call per doc)
  Stage 1: split each HTML RFP doc into sections (splitIntoSections). The plan text
    (approach/services) is the reference. Pair each section with the plan text.
  Stage 2: ONE batched model call per doc — "does this section state an approach,
    team composition, or service that CONTRADICTS the solution plan?" → verbatim
    snippet + why. Emit SOLUTION_PLAN_MISMATCH / major, anchored to the heading.
  (Note: covers team ONLY where a team claim happens to sit in the plan prose —
   the assigned people almost never do. Structured team coverage is C6c.)

C6c — TEAM-ROSTER consistency  (deterministic candidates → ONE batched model verify)
  Stage 1: from planTeam, take FILLED lines only (role → assigned person; drop
    UNFILLED open roles and DELETED-employee lines). Scan the package for a
    passage/field/cell that mentions a plan role AND names a person OTHER than the
    plan's assignee. Loose = high recall. (The role LABEL is stripped from the
    chunk before the name scan so a multi-word title like "Project Manager" can't
    masquerade as a competing person.)
  Stage 2: ONE batched model call — [{ role, planPerson, packageSnippet,
    statedNames }] → keep only genuine SAME-role / DIFFERENT-person contradictions
    (never a nickname/abbreviation of the same person, never a different role).
    Emit SOLUTION_PLAN_MISMATCH / major, anchored to the spot.

C6d — PERSON→ROLE consistency  (deterministic candidates → ONE batched model verify)
  The transpose of C6c. C6c keys on the plan ROLE (is it filled by the wrong
  person?); C6d keys on the plan PERSON (is this person listed under the wrong
  role?). Roles are open-vocabulary — there is no role regex the way names have
  personNameRegex — so Stage 1 anchors on the finite PERSON set and lets the model
  read the stated role out of the snippet.
  Stage 1: from planTeam, take FILLED lines only (person → assigned role). Scan the
    package for a passage/field/cell that (a) NAMES a plan person (every significant
    name token present as a word — matches the abbreviated "Petro T." roster form
    that personNameRegex cannot) AND (b) plausibly STATES a role (a generic
    role/title hint word: "role", "serves as", "developer", "engineer", "manager",
    …) AND (c) does NOT already state that person's OWN plan role (the package
    agreeing is not a contradiction). Loose = high recall.
  Stage 2: ONE batched model call — [{ person, planRole, packageSnippet }] → keep
    only genuine SAME-person / DIFFERENT-role contradictions (never a different
    person, never a title/format variant or seniority prefix of the SAME role, never
    when the passage states no role). Emit SOLUTION_PLAN_MISMATCH / major, anchored
    to the spot.
```

**Why this shape (identical rationale to the factual checks):**
- **Token-safe:** the model sees small snippets + the (already-truncated) plan text,
  never the whole package.
- **Precision-only ceiling:** loosen the Stage-1 generator to raise recall; the
  model is the precision gate — prompt stays stable across tuning.

**Mandatory instrumentation (FR-9):** after Stage 2, once per sub-check family:
```ts
console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6-solution-plan', generated, kept }));
```

---

## 3. Data Models & Zod Schemas — `packages/core` <!-- ✅ IMPLEMENTED -->

**File:** `packages/core/src/schemas/compliance-review.ts` (edit)

Add one issue type to `ComplianceIssueTypeSchema`:

```typescript
export const ComplianceIssueTypeSchema = z.enum([
  'MISSING_REQUIREMENT',
  'MISSING_FORM',
  'INCORRECT_ANSWER',
  'POOR_ANSWER',
  'FORMAT_ISSUE',
  'INCONSISTENCY',
  'FACTUAL_INACCURACY',
  'UNVERIFIED_CLAIM',
  'NDA_DISCLOSURE_LEAK',
  'SOLUTION_PLAN_MISMATCH', // NEW — a package claim contradicts the latest solution plan (C6)
  'OTHER',
]);
```

**CRITICAL — the two-enum trap.** Also add `'SOLUTION_PLAN_MISMATCH'` to the
`issueType` enum inside `RawFindingSchema` in `compliance-review-engine.ts`. That
enum uses `.catch('OTHER')`; a model-emitted new type silently degrades to `OTHER`
unless it is listed there too. (This is the exact gotcha recorded when C1–C5 shipped.)

No change to `ComplianceFindingSchema` shape, target kinds, or the anchor union —
C6 findings reuse the existing anchors (heading/cell/field). The plan reference
(service label, plan price/billing) goes in `description`/`suggestion` text, exactly
as C4 cites the past-performance record value.

**Verify:** `pnpm --filter @auto-rfp/core build`, then dependent typechecks.

---

## 4. Truth-source access — extend `compliance-truth-sources.ts` <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/compliance-truth-sources.ts` (edit) — add one
loader, best-effort (`null` on error), so C6 and the chat tool share it:

```typescript
/** The latest READY solution plan for an opportunity + its plain-text body.
 *  Best-effort → null on any failure or when no READY plan exists. A stale-but-
 *  READY plan IS returned (mirrors document generation — the latest plan is the
 *  reference). Wraps loadApprovedSolutionPlanContext. */
export interface SolutionPlanFacts {
  planId: string;
  version: number;
  isStale: boolean;
  /** Plain-text of the plan HTML (approach/services/timeline/risks). */
  text: string;
  /** Structured cost items with a concrete amount (null-amount items dropped). */
  costItems: Array<{ label: string; amount: number; billing: string; category: string; optional: boolean }>;
  currency: string;
  /** FILLED planTeam lines only (role → assigned person). C6c source of truth. */
  teamMembers: Array<{ name: string; role: string }>;
}

export const loadSolutionPlanFacts = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<SolutionPlanFacts | null>;
```

Implementation notes:
- Call `loadApprovedSolutionPlanContext({ orgId, projectId, opportunityId: oppId })`.
  Returns `null` → C6 returns `[]` (no plan / not READY → nothing to check against).
- `text` = the returned `text` (already stripped + truncated).
- `costItems` = `plan.costSchedule?.items` filtered to `amount != null` (a
  null-amount item is "vendor quote required" — no concrete figure to contradict),
  mapping `label`, `amount`, `billing`, `category`, `optional`.
- `currency` = `plan.costSchedule?.currency ?? 'USD'`.
- `teamMembers` = `plan.planTeam?.members` filtered to FILLED lines only
  (`!removedEmployee && employeeId && nameSnapshot`), mapping `{ name:
  nameSnapshot.trim(), role: role.trim() }`, dropping any with an empty name/role.
  UNFILLED (open role) and DELETED-employee lines are dropped — there is no
  authoritative "role X is staffed by person Y" to contradict. **Read the RAW
  `planTeam` field, not the GET endpoint's derived team:** a stale `nameSnapshot`
  is the value the package was written from, which is exactly what C6c compares
  against.
- Wrap everything in `try/catch → null` (defence in depth — the caller also
  fail-opens).

> **Lazy-import guard:** `loadApprovedSolutionPlanContext` lives in
> `generate-document-worker.ts`, a heavy module. Import it lazily
> (`const { loadApprovedSolutionPlanContext } = await import('@/helpers/generate-document-worker')`)
> to avoid pulling the document-generation graph into every compliance-review cold
> start — mirror the `listAllPastProjects` lazy-import already in this file.

---

## 5. C6a — Cost-schedule consistency (`compliance-review-solution-plan.ts`, NEW) <!-- ✅ IMPLEMENTED -->

**New file:** `apps/functions/src/helpers/compliance-review-solution-plan.ts`

Model this sub-check on `compliance-review-pastperf.ts` (deterministic scan for a
label + formatted value → batched verify against records).

1. **Stage 1 (deterministic candidates):** for each plan `costItem`, scan every
   package artifact (HTML doc text, questionnaire cells, form field label+value)
   for a passage that (a) mentions the service **label** (word-bounded, reuse
   `containsWord` from `compliance-review-consistency.ts`; for multi-word labels,
   partial-token overlap like `computeProfileFactFindings` does) AND (b) carries a
   formatted **price** near it (reuse the `DOLLAR_RE` shape from
   `compliance-review-pastperf.ts`). Emit a candidate
   `{ item, statedPrice, targetKind, documentId, documentTitle, anchor?, snippet }`.
   Over-flag freely — Stage 2 is the gate. Anchor is free (heading+snippet for
   HTML, field for forms, cell for questionnaires).
2. **Stage 2 (ONE batched model call):** feed
   `[{ i, serviceLabel, planAmount, planBilling, currency, snippet, statedPrice }]`
   → the model returns only genuine SAME-service price/billing contradictions
   (`{ index, field: "price"|"billing", stated, planValue }`). Prompt mirrors
   `buildVerifyPrompt` in pastperf: "only report a genuine mismatch for the SAME
   service; never a different service; never when unsure."
3. **Emit** `SOLUTION_PLAN_MISMATCH` / `major`, citing both values
   ("the solution plan prices `<label>` at `<planAmount>/<planBilling>`; this
   document states `<statedPrice>`"), anchored to the spot.

Cap Stage-1 candidates with `MAX_FACTUAL_CANDIDATES_PER_CHECK`. Log
`factual-candidates` with `factType: 'C6a-plan-cost'`.

---

## 6. C6b — Prose contradiction (same new file) <!-- ✅ IMPLEMENTED -->

Model this sub-check on `compliance-review-kb-contradiction.ts`. Runs on **HTML RFP
documents only** (forms have no prose; questionnaire cells are covered by C6a).

1. **Stage 1:** split each HTML doc into sections (`splitIntoSections`) so the
   heading is a valid anchor and the section text is the snippet source. The plan
   `text` (already plain, truncated) is the single reference — no retrieval needed
   (unlike C3, which retrieves KB hits; here the whole plan is the truth and it's
   small enough to pass wholesale).
2. **Stage 2 — ONE batched model call per document:**
   `{ planText, sections: [{ i, heading, sectionText }] }` → return only sections
   that **contradict** the plan's approach / team composition / selected services
   (a genuinely DIFFERENT method, team, or service — NOT merely omission, extra
   detail, or different wording), each with `{ index, verbatimSnippet, why }`.
   Prompt mirrors `buildContradictionPrompt`.
3. **Build** `SOLUTION_PLAN_MISMATCH` / `major`, `targetKind: 'RFP_DOCUMENT'`,
   `anchor: { kind:'heading', text: <REAL heading from code, not the model> }`,
   `snippet: verbatimSnippet` (validate.ts enforces it's a real substring — a
   paraphrase just flips `anchorValid=false`, no crash). Heading-less docs produce
   anchor-less snippet-search findings — acceptable, note it.

Bound the plan text fed to the model (reuse the doc-worker's `SOLUTION_PLAN_TEXT_BUDGET`
truncation, which `loadApprovedSolutionPlanContext` already applies). Cap sections
with `MAX_FACTUAL_CANDIDATES_PER_CHECK`. Log `factType: 'C6b-plan-prose'`.

**Anchor contract:** identical to C3 — section-aligned chunking + verbatim-snippet
instruction is what makes `anchorValid` true and "go to spot" work.

---

## 6.5. C6c — Team-roster consistency (same new file) <!-- ✅ IMPLEMENTED -->

Model this sub-check on **C6a** (structured source → deterministic candidate scan →
ONE batched verify), NOT on C6b. The team is a structured roster, so it gets the
crisp deterministic treatment prices get — not the fuzzy prose treatment.

1. **Stage 1 (deterministic candidates):** for each FILLED `teamMembers` line
   (`{ role, name }`), scan every package artifact (HTML doc text, questionnaire
   cells, form field label+value) for a passage that (a) mentions the **role**
   (word-bounded via `containsWord`; multi-word roles match on majority token
   overlap, same `mentionsRole`/`mentionsService` shape) AND (b) names a **person**
   near it (`personNameRegex`). **Strip the role label from the chunk before the
   name scan** so a title like "Project Manager" can't be read as a person and
   can't fuse with a leading word ("The Project Manager" → "The Project"). Drop
   names equal to the plan's own assignee (package agrees → not a contradiction)
   and names beginning with a capitalized function word (`The`/`Our`/…). Emit a
   candidate `{ item, statedNames, targetKind, documentId, documentTitle, anchor?,
   snippet }`. Over-flag freely — Stage 2 is the gate.
2. **Stage 2 (ONE batched model call):** feed
   `[{ i, role, planPerson, snippet, statedNames }]` → the model returns only
   genuine SAME-role / DIFFERENT-person contradictions (`{ index, stated }`).
   Prompt: "only report a genuine staffing contradiction for the SAME role; never
   a different role; never a nickname/abbreviation of the SAME person; never when
   unsure."
3. **Emit** `SOLUTION_PLAN_MISMATCH` / `major`, citing both people ("the solution
   plan assigns `<role>` to `<planPerson>`; this document names `<statedPerson>`"),
   anchored to the spot (heading+snippet for HTML, field for forms, cell for
   questionnaires).

Cap Stage-1 candidates with `MAX_FACTUAL_CANDIDATES_PER_CHECK`. Log
`factual-candidates` with `factType: 'C6c-plan-team'`.

**Deferred (do NOT add in v1):** flagging UNFILLED plan roles that the package
staffs, or plan-staffed people the package omits — that is the open-role/coverage
diff, deferred for the same over-flagging reason as the missing/extra-service diff.

---

## 6.6. C6d — Person→role consistency (same new file) <!-- ✅ IMPLEMENTED -->

Model this sub-check on **C6c**, but transposed: C6c iterates plan ROLES and looks
for a different PERSON; C6d iterates plan PEOPLE and looks for a different ROLE.

**Why C6d is a separate check, not a C6c prompt tweak.** C6c's Stage-1 generator
keys candidates on the role label — it can only surface a passage where the plan
*role* text co-locates with a competing name. When a package edit relabels an
existing person's role (the observed real case: doc generation restated "Full-Stack
Developer" as "Frontend Developer" for the same person), that person no longer sits
next to their plan role in any chunk, so C6c generates only cross-role noise and the
Stage-2 model correctly rejects all of it (`generated:N, kept:0`). The defect is
invisible to a role-keyed scan and is explicitly excluded by C6c's prompt ("never a
different role"). C6d closes that gap.

**Why person-anchored (not role-anchored) Stage 1.** Roles are open-vocabulary; there
is no role regex the way `personNameRegex` bounds names. The plan's PEOPLE are a small
finite set, so C6d scans for each plan person by name and hands any role-bearing
passage to the model — the model reads the stated role out of the snippet (the
precision gate), rather than a brittle deterministic role extractor.

1. **Stage 1 (deterministic candidates):** for each FILLED `teamMembers` line
   (`{ name, role }`), scan every package artifact (HTML doc text, questionnaire
   cells, form field label+value) for a passage that (a) NAMES the person —
   `mentionsName` requires every *significant* name token (alphabetic, ≥2 chars;
   single-letter initials dropped) to appear as a word, so the abbreviated roster
   form "Petro T." / "Kateryna P." matches where `personNameRegex` cannot — AND
   (b) plausibly STATES a role at all (`ROLE_HINT_RE`: a generic role/title signal
   word — "role", "position", "serves as", "developer", "engineer", "manager",
   "designer", "architect", "analyst", …) AND (c) does NOT already mention the
   person's OWN plan role (`mentionsRole` — the package agreeing is not a
   contradiction; mirrors C6c dropping the plan assignee). Emit a candidate
   `{ item, targetKind, documentId, documentTitle, anchor?, snippet }`. Over-flag
   freely — Stage 2 is the gate.
2. **Stage 2 (ONE batched model call):** feed `[{ i, person, planRole, snippet }]`
   → the model returns only genuine SAME-person / DIFFERENT-role contradictions
   (`{ index, stated }`, `stated` = the role the passage assigns). Prompt: "only
   report a role contradiction for the SAME person; never a different person; never
   a mere title/format variant, seniority prefix, or broader/narrower phrasing of
   the SAME role; never when the passage states no role or you are unsure." Reuses
   C6c's `parseTeamMismatches` — identical `{ index, stated }` shape.
3. **Emit** `SOLUTION_PLAN_MISMATCH` / `major`, citing both roles ("the solution plan
   assigns `<person>` to `<planRole>`; this document lists them as `<statedRole>`"),
   anchored to the spot (heading+snippet for HTML, field for forms, cell for
   questionnaires).

Cap Stage-1 candidates with `MAX_FACTUAL_CANDIDATES_PER_CHECK`. Log
`factual-candidates` with `factType: 'C6d-plan-role'`.

**Deferred (do NOT add in v1):** same open-role/coverage exclusions as C6c — a plan
person the package omits entirely, or a package role that names nobody, is not a
contradiction. Coverage is same-person / different-role only.

---

### Public entry point

```typescript
export const computeSolutionPlanFindings = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const plan = await loadSolutionPlanFacts(args.orgId, args.projectId, args.oppId);
    if (!plan) return [];                    // no READY plan → nothing to check
    const [cost, prose, team, role] = await Promise.all([
      computePlanCostFindings(plan, args),   // C6a
      computePlanProseFindings(plan, args),  // C6b
      computePlanTeamFindings(plan, args),   // C6c (role → person)
      computePlanRoleFindings(plan, args),   // C6d (person → role)
    ]);
    return [...cost, ...prose, ...team, ...role];
  } catch (err) {
    console.warn('[compliance-review-solution-plan] check failed:', (err as Error)?.message);
    return [];
  }
};
```

---

## 7. Wire into `runFullReview` <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/compliance-review-engine.ts` (edit
`runFullReview`'s `augmentFindings`):

```typescript
const [missing, inconsistent, profileFacts, certs, kb, pastperf, ndaLeak, solutionPlan] =
  await Promise.all([
    // …existing seven…
    computeSolutionPlanFindings({
      orgId: args.orgId, projectId: args.projectId, oppId: args.oppId,
      modelId: args.modelId, inventory,
    }), // C6
  ]);
return [...missing, ...inconsistent, ...profileFacts, ...certs, ...kb, ...pastperf, ...ndaLeak, ...solutionPlan];
```

`oppId` is already in scope in `runFullReview` (`args.oppId`) — no signature change
to the public entry point. All C6 findings flow through `validateAndTagFindings`
(fingerprint/decision persistence is automatic).

Update `SYSTEM_PROMPT` to add a bullet describing solution-plan consistency + the
new issue type, so the model can also surface it conversationally:
> - Solution-plan mismatches (a price, team, approach, or service in the package
>   that contradicts the latest approved solution plan) → issueType SOLUTION_PLAN_MISMATCH

---

## 8. Chat (optional in v1) <!-- ✅ IMPLEMENTED -->

The full-review augmenter is the primary deliverable. For chat parity, extend the
existing `verify_company_facts` tool in `compliance-review-tools.ts`: add
`"solution_plan"` to its `sources` enum and, when requested, append a
solution-plan snapshot (plan version + a bounded slice of `text` + the cost items)
to the tool's returned content via `loadSolutionPlanFacts`. This keeps chat
bounded (no new tool, no new round budget). Defer if time-constrained — it does not
block the full-review value.

---

## 9. Fingerprint behavior & deferred scope <!-- ✅ IMPLEMENTED -->

- **C6a (deterministic price candidates):** code-generated snippet/title →
  byte-stable fingerprint → dismissals persist across re-runs.
- **C6b (model prose findings):** may resurface once after a substantial reword
  (different snippet → different fingerprint). Same accepted tradeoff the engine
  documents for C1-prose / C3. Do NOT invent a new identity scheme.

- **C6c / C6d (deterministic team candidates):** code-generated snippet/title →
  byte-stable fingerprint → dismissals persist across re-runs (same as C6a). C6c and
  C6d emit distinct `findingId` prefixes (`solution-plan-team-*` vs
  `solution-plan-role-*`) so a role→person and a person→role finding on the same spot
  never collide.

**Deferred (do NOT add in v1 without a new decision):**
- **Missing/extra-service diff** — flagging services the plan prices but the package
  omits, or vice-versa. Package prose rarely enumerates services like the schedule
  does → over-flags. Coverage decision was **contradictions only**.
- **Open-role / unstaffed-position diff (C6c/C6d)** — flagging UNFILLED plan roles the
  package staffs, or plan-staffed people the package omits. Same over-flag risk as
  the service diff; coverage is contradictions only (C6c: SAME role, DIFFERENT person;
  C6d: SAME person, DIFFERENT role).
- **Timeline/phase date contradictions** — the plan's Timeline section vs package
  dates. Fuzzy; fold into C6b prose only if the model naturally catches it, don't
  build a dedicated date matcher.
- **Skip-if-stale** — decided against; the latest READY plan is always the reference.

---

## 10. Constants <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/constants/compliance-review.ts` — reuse
`MAX_FACTUAL_CANDIDATES_PER_CHECK`, `MAX_TOKENS_FACTUAL`, `MAX_FACTUAL_SECTION_CHARS`.
Add only if a distinct bound is needed:
- `MAX_SOLUTION_PLAN_TEXT_CHARS` — cap on plan text fed to the C6b verifier (if the
  doc-worker's budget is larger than what one contradiction call should carry).

---

## 11. Tests (co-located, per `.claude/rules/09-testing.md`) <!-- ✅ IMPLEMENTED -->

| File | Covers |
|---|---|
| `packages/core/src/schemas/compliance-review.test.ts` | `SOLUTION_PLAN_MISMATCH` parses; existing findings still valid (Vitest) |
| `apps/functions/src/helpers/compliance-truth-sources.test.ts` | EXTEND: `loadSolutionPlanFacts` — READY plan returns text+costItems+teamMembers; null-amount items dropped; FILLED planTeam lines kept while UNFILLED/DELETED dropped; no-planTeam → empty teamMembers; not-READY / no-plan → null; stale-but-READY still returned; fail-open → null |
| `apps/functions/src/helpers/compliance-review-solution-plan.test.ts` | NEW: C6a price mismatch flagged, matching price NOT flagged, billing mismatch flagged; C6b prose contradiction flagged with heading+verbatim anchor, agreeing prose not flagged; heading-less doc degrades; **C6c staffing mismatch flagged (different person), plan-assignee named → no candidate, model reports no mismatch → not flagged, form-field anchor, no filled team lines → no call, model failure → `[]`**; **C6d role mismatch flagged (same person, different role), person under own plan role → no candidate, person named with no role signal → no candidate, abbreviated-surname ("Petro T.") match + form-field anchor, model reports no mismatch → not flagged, no filled team lines → no call, model failure → `[]`**; no plan → `[]`; model failure → `[]` |
| `apps/functions/src/helpers/compliance-review-engine.test.ts` (if present) | C6 augmenter wired; failure isolated (one augmenter throwing doesn't drop the others) |

Mock AWS SDK + `invokeModel` + `loadApprovedSolutionPlanContext`; reset in
`beforeEach`; test the exported functions, not the middy handler.

---

## 12. Frontend — labels only <!-- ✅ IMPLEMENTED -->

**File:** `apps/web/features/compliance-review/components/FindingsStats.tsx` — add
`SOLUTION_PLAN_MISMATCH: 'solution-plan mismatches'` to `ISSUE_LABELS`. Any other
place that maps `ComplianceIssueType` → a label/icon gets the same entry. Findings
render through the existing `FindingsList` path — no structural change. (TypeScript
will flag every exhaustive `Record<ComplianceIssueType, …>` that needs the new key
once core is rebuilt — follow the compiler.)

---

## 13. Implementation tickets <!-- ✅ IMPLEMENTED -->

| # | Ticket | Files | Est. |
|---|---|---|---|
| SP-1 | Core: `SOLUTION_PLAN_MISMATCH` issue type (+ `RawFindingSchema` enum in engine) | `compliance-review.ts`, `compliance-review-engine.ts`, core test | 30 min |
| SP-2 | Truth-source: `loadSolutionPlanFacts` (+ lazy import) + tests | `compliance-truth-sources.ts` | 2 h |
| SP-3 | C6a cost-schedule consistency (deterministic → verify) | `compliance-review-solution-plan.ts` + test | 4 h |
| SP-4 | C6b prose contradiction (section-chunked → verify) | `compliance-review-solution-plan.ts` + test | 4 h |
| SP-5 | Wire `computeSolutionPlanFindings` + `SYSTEM_PROMPT` into `runFullReview` | `compliance-review-engine.ts` | 45 min |
| SP-6 | Chat: `solution_plan` source on `verify_company_facts` (optional) | `compliance-review-tools.ts` + test | 2 h |
| SP-7 | Frontend label | `apps/web/features/compliance-review/` | 20 min |
| SP-8 | C6c team-roster consistency: `personNameRegex` (text helper) + `teamMembers` on `SolutionPlanFacts` (truth-source) + `computePlanTeamFindings` (deterministic → verify) wired into the entry point | `compliance-review-text.ts`, `compliance-truth-sources.ts`, `compliance-review-solution-plan.ts` + tests | 4 h |
| SP-9 | C6d person→role consistency: `computePlanRoleFindings` (deterministic → verify) — `mentionsName` (abbreviated-surname match) + `ROLE_HINT_RE` (generic role signal), person-anchored Stage 1, reuses `parseTeamMismatches`; wired into the entry point as the 4th sub-check | `compliance-review-solution-plan.ts` + tests | 3 h |

**Order:** SP-1 → SP-2 → SP-3 → SP-4 → SP-5 → SP-7 → (SP-6 optional) → SP-8 → SP-9. Rebuild
`@auto-rfp/core` after SP-1. Verify `pnpm tsc --noEmit` after each backend ticket.
(SP-8 and SP-9 reuse the SP-1 issue type and the SP-5 wiring — no core-enum or engine
change: C6c and C6d are additional sub-checks inside the existing
`computeSolutionPlanFindings` augmenter, emitting the same `SOLUTION_PLAN_MISMATCH`
type the engine already handles. SP-9 also reuses SP-8's `teamMembers` source and
`parseTeamMismatches` parser — it adds no new truth-source field.)

---

## 14. Acceptance criteria <!-- ✅ IMPLEMENTED -->

- [ ] Full review emits `SOLUTION_PLAN_MISMATCH` when the package price/billing for a
      service contradicts the plan's cost schedule (C6a), when package prose
      contradicts the plan's approach/services (C6b), when the package staffs a
      plan role with a different person than the plan's `planTeam` assigns (C6c), and
      when the package lists a plan person under a different role than the plan
      assigns them (C6d).
- [ ] A matching price / agreeing prose / plan-assigned person / plan-assigned role
      produces NO finding (contradictions only).
- [ ] The latest READY plan is used even when `isStale`; no READY plan → check emits `[]`.
- [ ] Null-amount ("vendor quote required") cost items never produce a price finding.
- [ ] Only FILLED `planTeam` lines feed C6c and C6d; UNFILLED/DELETED lines and a plan
      with no team never produce a staffing/role finding (and no team/role verify call
      is made).
- [ ] C6d matches the abbreviated-surname roster form ("Petro T.") and requires a role
      signal — a bare narrative mention of a plan person produces no candidate.
- [ ] Every C6 finding cites the plan value and anchors to a real spot (passes
      `validateAndTagFindings`); "go to spot" works for heading/field/cell anchors.
- [ ] C6 is fail-open (`try/catch → []`) — a solution-plan/S3 outage never fails a review.
- [ ] C6 emits the structured `factual-candidates` instrumentation line(s).
- [ ] `loadApprovedSolutionPlanContext` is lazy-imported (no doc-worker graph in the cold start).
- [ ] Co-located tests for all new/changed code; `pnpm tsc --noEmit` passes per package.
- [ ] No new CDK stacks / infra cost.

---

## 15. Summary of new/changed files <!-- ✅ IMPLEMENTED -->

| File | Change | Status |
|---|---|---|
| `packages/core/src/schemas/compliance-review.ts` | +1 issue type | ✅ |
| `apps/functions/src/helpers/compliance-review-engine.ts` | wire C6 augmenter + prompt + `RawFindingSchema` enum | ✅ |
| `apps/functions/src/helpers/compliance-truth-sources.ts` | +`loadSolutionPlanFacts` (lazy import); +`teamMembers` (FILLED planTeam lines) for C6c | ✅ |
| `apps/functions/src/helpers/compliance-review-text.ts` | +`personNameRegex` (C6c name heuristic) | ✅ |
| `apps/functions/src/helpers/compliance-review-solution-plan.ts` | NEW — C6a + C6b + C6c + C6d | ✅ |
| `apps/functions/src/helpers/compliance-review-tools.ts` | +`solution_plan` source on `verify_company_facts` (optional) | ✅ |
| `apps/functions/src/constants/compliance-review.ts` | +bounds (only if needed); C6c note in the C6 comment | ✅ |
| `apps/web/features/compliance-review/components/FindingsStats.tsx` | issue-type label | ✅ |
| `*.test.ts` (§11) | tests | ✅ |
