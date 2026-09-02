# Opportunity Progress Bar — Spec

> Status: ready for implementation (no AI-DLC required). Synthesized from the
> `260828-opportunity-progress-bar` intent (ideation + inception + u1 functional
> design) plus a fresh codebase scan of the existing opportunity-page data hooks.

## Problem Statement

When a user opens an opportunity page, the only orientation device at the top is a
"Jump to" chip row — a flat set of anchor links (Solicitations, Analysis, Solution
Plan, Required Forms, RFP Documents, Related RFPs, AI Review, Submission, Post-Award).
Nothing about that row communicates that these sections are a *sequence of steps* the
user must work through to prepare a submittable opportunity package. Users can't tell,
at a glance:

- which steps are done and which are left,
- what the next action is,
- how much work remains inside a step ("2 of 3 forms filled", "0 of 7 required documents"),
- or — most dangerously — that a step which *was* complete has been invalidated because
  a new solicitation document was uploaded after it finished.

The result: missed required items, slow "where do I go next?" hunting, repeated support
questions, and a steep onboarding curve for new users.

## Solution

Replace the "Jump to" chip row with a fixed, multi-step **progress bar** that models the
package-preparation flow as a connected stepper. Each step shows a status icon/color, a
clickable name, and a compact detail line (a count or status word). The bar pins to the
top of the viewport as the user scrolls (condensing to a slim variant), collapses to a
compact two-row treatment on mobile, and renders fully even for a brand-new opportunity —
so the bar itself *is* the onboarding guidance.

The seven steps, in flow order, are:

**Solicitations → Analysis → Solution Plan → Required Forms → RFP Documents → AI Review → Submission.**

(Related RFPs and Post-Award remain page sections but are **not** steps in the bar.)

Every step's status and count is computed **client-side** from data the opportunity page
already fetches — no new backend endpoints, no new persisted state. When a new solicitation
document is uploaded, every downstream step that had progress flips to **Needs attention**
(preserving its counts, never resetting them) so stale work is never shown as complete; the
step self-heals back to its true status once the user re-runs that step's own action.

Clicking a step is modeled as a *generic navigation action* (today: smooth-scroll to the
page section) so a future "Questions" step can navigate to another page without redesign.

## User Stories

1. As an opportunity-page user, I want a progress bar at the top of the page that shows the package-preparation flow as ordered steps, so that I understand the process is a sequence, not a flat menu.
2. As an opportunity-page user, I want each step to show a status icon and color (not started / in progress / complete / needs attention), so that I can see at a glance what is done and what is left.
3. As an opportunity-page user, I want each step to show a compact count or status word ("2 of 3 filled", "0 of 7 required", "Ready"), so that I know how much work remains inside a step without opening it.
4. As an opportunity-page user, I want to click a step's name or circle to jump to that section, so that I can act on the next thing quickly.
5. As an opportunity-page user, I want the bar to pin to the top of the viewport and condense as I scroll, so that I keep my orientation deep in a long page.
6. As an opportunity-page user scrolled deep in the page, I want to hover/focus a condensed circle to see that step's name and count, so that I can identify a step without scrolling back up.
7. As an opportunity-page user, I want the condensed bar to always show the current (first non-complete) step's name and count inline, so that I always know what to do next.
8. As a mobile opportunity-page user, I want a compact bar with an overall "K of N" count, small status circles, and a "Next: <step>" line, so that I can read my status at a glance on a small screen.
9. As a mobile opportunity-page user, I want touch targets of at least 44px on each circle, so that I can tap a step reliably.
10. As a new user opening a fresh opportunity, I want the bar to render fully with all steps "Not started" / "0 of N", so that the bar guides me through what to do first.
11. As an opportunity-page user, I want the bar to render as a skeleton while data loads (never a spinner), so that the page feels consistent with the rest of the app.
12. As an opportunity-page user, I want steps for features my org has disabled (Solution Plan, AI Review) to be omitted from the bar entirely, so that I'm not shown steps that don't apply to me.
13. As an opportunity-page user, I want the Required Forms step hidden when the solicitation has no detected required forms, so that the bar only shows steps that are relevant.
14. As an opportunity-page user, I want the Solicitations step to be complete only when at least one file exists and every non-deleted solicitation file is fully processed, showing "X of Y processed", so that I know my inputs are ready.
15. As an opportunity-page user, I want the Analysis step to be complete only when all 8 brief sections are generated, showing "N of 8 sections", so that I know the analysis is finished.
16. As an opportunity-page user, I want the Solution Plan step to show a status word (Not started / Generating / Draft / Ready), so that I know where the plan stands.
17. As an opportunity-page user, I want the Required Forms step to show "X of Y filled" (forms with every field filled, of total detected) and be complete only when every detected form is fully filled, so that I don't miss a form.
18. As an opportunity-page user, I want the RFP Documents step to count against the brief's required-documents list ("X of Y required") and be complete only when every required document exists and is Ready/Approved, so that I produce exactly the documents the solicitation demands.
19. As an opportunity-page user whose brief has no required-documents list yet, I want the RFP Documents step to fall back to "X of Y ready" over the documents that exist, so that the step is still meaningful.
20. As an opportunity-page user, I want the AI Review step to be complete only when the latest run is Ready, not stale, and every blocking-severity finding is resolved or dismissed, and to show the open-findings count otherwise, so that I don't submit with unresolved blocking issues.
21. As an opportunity-page user, I want the Submission step to show the compliance pass rate before submission and "Submitted" after, so that I know how close I am to a submittable package and when I've submitted.
22. As an opportunity-page user, when I upload a new solicitation document after downstream steps were complete, I want every downstream step that had progress to flip to "Needs attention" with an explanatory reason, so that I'm never misled into thinking stale work is current.
23. As an opportunity-page user, I want a "Needs attention" step to preserve its counts and underlying work (never reset), so that I don't lose progress when I re-run it.
24. As an opportunity-page user, I want a "Needs attention" step to return to Complete/In progress automatically once I re-run that step's own action, so that the bar self-heals without a manual acknowledgement.
25. As an opportunity-page user, when a step's status can't be computed, I want it to show a neutral "?" / "Status unavailable" and remain clickable, so that a data glitch never blocks my navigation or breaks the bar.
26. As an opportunity-page user, I want a failure computing one step's status to never affect the other steps or the page, so that the bar is reliable.
27. As a keyboard user, I want the bar to be a labeled `nav` landmark with one tab stop per step (Enter activates), so that I can navigate the flow without a mouse.
28. As a screen-reader user, I want each step's status conveyed in text ("Required Forms, needs attention, 2 of 3 filled"), never color alone, so that I get the same information a sighted user does.
29. As an opportunity-page user, I want the bar's statuses to refresh on the page's existing smart-refresh cadence, so that they stay current without new machinery or extra load.
30. As an opportunity-page user, I want to expand a step to see a details view — its per-item state (each form's fill state, each required document's readiness, the brief's section list) and a one-line "what's this step?" description — so that I understand exactly what remains.
31. As a keyboard user, I want the step-details view to be openable via keyboard, closable with Escape, and to return focus to the step, so that it's fully accessible.
32. As a product owner, I want step clicks modeled as generic navigation actions (not hardwired anchors), so that a future Questions step can navigate to another page without a redesign.
33. As an opportunity-page user, I want the connector line between two steps to fill solid when the left step is complete (dashed/hollow otherwise), so that the bar reads as a flow.
34. As an opportunity-page user, I want long step names to truncate with an ellipsis + tooltip and the bar to wrap before horizontal scrolling on narrow windows, so that the layout stays clean.

## Implementation Decisions

### Placement & feature module

- New feature module `apps/web/features/opportunity-progress/` following feature-sliced
  design: `lib/` (pure rules + types), `hooks/` (the assembly hook), `components/` (the
  bar and its variants + details popover), `index.ts` barrel. Pages/host import only from
  the barrel.
- `OpportunityView` (`apps/web/components/opportunities/OpportunityView.tsx`) is the sole
  host: it renders the new bar where the `SectionNavigation` "Jump to" row lives today
  (line ~298) and **retires** `SectionNavigation`. The section cards, their hidden
  `data-doc-status` markers, and `useSmartPolling` are left untouched (ADR-003).

### Three components (ADR-001, ADR-004, ADR-005)

1. **StepStatusRules** (`lib/`, pure, no React, no I/O) — one exported pure function per step
   mapping that step's data snapshot to a `StepEvaluation` (`{ stepId, status, detailText, reason? }`).
   Encodes the per-step completion/count rules and the staleness layer. Never throws; on
   uncomputable input returns `unavailable`. Fully unit-testable in isolation and, by design,
   server-movable later.
2. **ProgressAssembly** — a hook (e.g. `useOpportunityProgress`) that: decides the visible
   step set (org gating + forms presence), gathers each step's data from the **existing** data
   hooks/context, builds one `StepDataSnapshot` per visible step (pre-computing each snapshot's
   `latestTimestamp`), invokes the rules, and returns the ordered `ProgressStep[]` — each carrying
   a navigation action descriptor. Isolates per-step data failures so one failing source degrades
   only that step.
3. **ProgressBarUI** — pure presentation: full / condensed-pinned / mobile stepper variants,
   skeleton loading, empty state, four statuses + the unavailable display, the details popover,
   accessibility semantics, and navigation activation on click/Enter. No data fetching, no business
   logic.

### Data sources (existing hooks — no new endpoints, ADR-001)

The assembly hook reads from these, all already used by the opportunity page. The bar reads the
org gating flags from `useCurrentOrganization()` (they are **not** on the opportunity context) and
ids/opportunity from `useOpportunityContext()`.

| Step | Hook / source | Status field & key values | Timestamp for staleness | Count source |
|------|---------------|---------------------------|--------------------------|--------------|
| Solicitations | `useQuestionFiles(projectId, { oppId })` (`lib/hooks/use-question-file.ts`) | `item.status`: UPLOADED/PROCESSING/TEXTRACT_RUNNING/TEXT_READY/PROCESSED/…/DELETED | per-file `updatedAt`/`createdAt` | fully-processed of non-deleted files |
| Analysis | `useGetExecutiveBriefByProject(orgId)` (`lib/hooks/use-executive-brief.ts`; mutation-trigger + local state) | 8 `brief.sections[k].status`: IDLE/IN_PROGRESS/COMPLETE/FAILED | brief `updatedAt` + per-section `updatedAt` | COMPLETE sections of 8 |
| Solution Plan | `useSolutionPlan(orgId, projectId, oppId)` (`features/solution-plan/hooks`) | `plan.status`: GRILLING/GENERATING_SOT/READY/FAILED | **native `plan.isStale` + `plan.staleReason`** (also `updatedAt`, `version`) | status word |
| Required Forms | `useApi<RequiredFormsListResponse>('/required-forms/list', …)` (inline in `RequiredFormsList.tsx`) | `form.status`: NEW/IN_PROGRESS/READY/DONE/FAILED | per-form `updatedAt` | forms fully filled of total (`totalFieldCount`/`manualFieldCount`) |
| RFP Documents | `useRFPDocuments(projectId, orgId, oppId)` (`lib/hooks/use-rfp-documents.ts`) | `doc.status`: GENERATING/DRAFT/IN_PROGRESS/NEEDS_REVIEW/READY/APPROVED/FAILED/RETRYING | per-doc `updatedAt` | required docs Ready/Approved of required-list size; fallback: ready/approved of existing |
| AI Review | `useReviewRun(orgId, projectId, oppId)` (`features/compliance-review/hooks`) | `run.status`: RUNNING/READY/FAILED | **native server `stale` boolean** (do not recompute) | open blocking findings (findings ∖ resolved/dismissed decisions by `fingerprint`) |
| Submission | `useComplianceReport` + `useSubmissionHistory` (`features/proposal-submission/hooks`) | submission `status`: SUBMITTED/WITHDRAWN | report `generatedAt`; submission `submittedAt`/`updatedAt` | pass rate (`passRate`) pre-submit; "Submitted" after |

The brief's required-documents list for the RFP Documents count lives at
`brief.sections.requirements.data.requiredDocuments` (`RequiredOutputDocument[]`).

**Note on the brief hook:** the brief is fetched via a `useSWRMutation` trigger + local state
inside `ExecutiveBriefView`, not a passive shared SWR read. The assembly hook must call the brief
hook itself (or a passive equivalent) rather than expecting a shared cache key.

### Per-step rules (StepStatusRules)

- **Solicitations** — not-started if no non-deleted file; in-progress while any is mid-pipeline;
  complete when ≥1 file exists AND all non-deleted files are fully processed. Detail: "X of Y processed".
- **Analysis** — not-started if no brief; in-progress while any section is generating / only some
  generated; complete when all 8 sections generated. Detail: "N of 8 sections".
- **Solution Plan** — not-started if no plan; in-progress (detail "Generating"; intermediate draft
  states → "Draft") while GRILLING/GENERATING_SOT; if READY and `isStale` → needs-attention (detail
  preserved as "Ready", reason = stored `staleReason` or "Outdated — new solicitation uploaded"); if
  READY and not stale → complete ("Ready").
- **Required Forms** — the rule returns not-started ("No required forms") when none detected; the
  **assembly** hides the step in that case (visibility is the hook's job, not the rule's). Otherwise
  in-progress while some forms/fields (including zero) are filled but not all; complete when ≥1 form
  detected and every detected form has all fields filled. Detail: "X of Y filled".
- **RFP Documents** — if the brief carries a required-documents list: "X of Y required" (Y = list size,
  X = required docs that exist and are Ready/Approved), complete when X = Y and Y > 0. Else fallback:
  "X of Y ready" over existing documents (Y = created, X = Ready/Approved), complete when all exist and
  ≥1 exists.
- **AI Review** — explicit precedence chain (first match wins): no run → not-started; latest run
  RUNNING → in-progress ("Running"); run stale (native signal, wins even over open findings) →
  needs-attention (detail = open-findings count if any else "Ready", reason "Outdated — review predates
  latest changes"); any blocking-severity finding neither resolved nor dismissed → in-progress (detail =
  open-findings count); else complete ("No open findings").
- **Submission** — SUBMITTED submission exists → complete ("Submitted"); else in-progress when
  compliance checks have run (detail = pass rate) or not-started when nothing has run.

### Staleness layer (FR4)

- **BR2.1 — uniform re-upload flip:** for every step downstream of Solicitations, after its base status
  is computed, if base is in-progress or complete AND the step's latest server timestamp predates the
  newest non-deleted solicitation upload timestamp → status becomes needs-attention, reason "Outdated —
  new solicitation uploaded", **counts/detail preserved (never reset)**.
- **BR2.2 — native signals take precedence:** Solution Plan (`isStale`) and AI Review (server `stale`)
  are hardcoded native-signal steps; for these BR2.1 is never applied — the native signal decides
  staleness and supplies the reason. All other downstream steps use BR2.1.
- **BR2.3 — self-healing:** needs-attention is never sticky; each evaluation pass recomputes from current
  data, so a step returns to its true base status once its data updates past the newest upload (or its
  native signal clears). Statuses are derived per pass, never persisted.
- **BR3.1 — unavailable fallback:** a rule that can't compute from its snapshot returns `unavailable`
  (detail "Status unavailable"), never throws, never guesses; other steps are unaffected. `unavailable`
  is a degraded *display*, not a fifth semantic status.

The newest-upload timestamp is derived from the Solicitations snapshot and passed to the rules as a
pre-computed value; the rules never extract timestamps from raw payloads. If that timestamp itself is
unavailable for a pass, the BR2.1 layer is skipped for that pass (base statuses stand; native signals
still apply).

### Entities / types (feature-local; ADR-005 — no persisted entities, no core schema)

Types live in the feature `lib/` (feature-local view models, not `@auto-rfp/core`, since nothing is
persisted). Inputs to the rules are typed against the existing `@auto-rfp/core` domain item types.

```
StepId        = 'solicitations' | 'analysis' | 'solution-plan' | 'required-forms'
              | 'rfp-documents' | 'ai-review' | 'submission'   // additive: future 'questions'
StepStatus    = 'not-started' | 'in-progress' | 'complete' | 'needs-attention' | 'unavailable'

StepDataSnapshot = {
  stepId: StepId
  domainData?: <step-specific slice of already-fetched domain data>   // absent/partial is legal
  latestTimestamp?: string   // ISO; newest server ts within the step's data, PRE-COMPUTED by the hook
}

StepEvaluation = {
  stepId: StepId
  status: StepStatus
  detailText: string          // compact count or status word, e.g. "2 of 3 filled", "Ready"
  reason?: string             // present when needs-attention (FR4.2); optional for unavailable
}

// Assembly output (ProgressStep = StepEvaluation core + presentation/navigation)
ProgressStep = StepEvaluation & {
  label: string
  navigation: NavigationDescriptor    // today: { kind: 'anchor', sectionId } ; future: { kind: 'route', href }
  visible: boolean
}
```

Use `z.enum([...])` or `as const` string unions for the enumerations — never TS enums (house rule).

### Navigation (FR3, ADR-004)

Each `ProgressStep` carries a `NavigationDescriptor`. For this release it's an anchor descriptor
(`sectionId`) that the presentation layer activates via smooth `scrollIntoView` (same section ids
already on the page: `solicitation-documents`, `executive-brief`, `solution-plan`, `required-forms`,
`rfp-documents`, `ai-compliance-review`, `submission-compliance`). The descriptor is a general
action so a future step can carry a route target instead — verified at design level; the future
step is not built.

### Visibility / gating (FR1.5, FR1.6)

- Solution Plan omitted when `!currentOrganization?.enableSolutionPlan`.
- AI Review omitted when `!currentOrganization?.enableComplianceReview`.
- Required Forms hidden when no required forms are detected (assembly decision).
- These mirror the exact gating `OpportunityView` already computes for `hiddenSectionIds`.

### Details popover (FR5.1 — in scope)

Committed for this release (reuses snapshot data already gathered, so cost is low). A Shadcn
`Popover` per step showing the step's per-item list (each form's fill state, each required
document's readiness, the brief's section list) + a hardcoded one-line "what's this step?"
description. Keyboard-openable (Enter on a secondary affordance), Escape closes, focus returns to
the step. Purely presentational — it reads the same snapshot the counts came from; no new fetching.

### Rendering variants & states (FR1)

- **Full bar:** connected stepper — status circles joined by connectors (solid when the left step is
  complete, dashed otherwise), step name + always-visible detail line under each node.
- **Condensed pinned:** slim single row of small circles + the current (first non-complete) step's
  name & count inline; other names/counts on hover/focus tooltip; all steps stay clickable and visible.
- **Mobile:** two rows — title + overall "K of N" count, small circles, "Next: <step> — <detail>" line;
  touch targets ≥ 44px.
- **Empty:** all visible steps not-started, "0 of N"/"Not started"; the bar still renders fully.
- **Loading:** skeleton placeholders (never spinners).
- **Unavailable:** neutral "?" + "Status unavailable"; step stays clickable.
- **Long names:** ellipsis + tooltip; wrap to two rows before horizontal scroll on narrow desktop.

### Freshness (NFR1, NFR2)

- The bar adds no new blocking requests on the critical path; it renders as skeleton immediately and
  fills as the existing hooks' data arrives.
- Statuses ride the page's existing smart-refresh cadence (`useSmartPolling`: 5s while processing, 30s
  idle, stop-after-3-unchanged). No new realtime machinery. The bar must not break the `data-doc-status`
  DOM marker contract the polling reads.

## Testing Decisions

Good tests here assert **external behavior** — the status/detail/reason a step ends up with given
domain data, the visible step set given gating, and what the rendered bar shows/does — not internal
structure. Timestamps in assertions use fixed input fixtures; never assert on wall-clock values.

All three seams get dedicated tests (confirmed with the developer):

### Seam 1 (primary) — StepStatusRules pure functions · Jest, co-located in `features/opportunity-progress/lib/`

The correctness core. Exhaustive, table-driven unit tests per rule, since these are pure functions
with no mocking required:

- Each of the 7 rules: happy path (each base status: not-started / in-progress / complete), the count
  string it produces, and boundary cases (empty list, all-done, partial, zero-filled forms, missing
  required-documents list → fallback, AI-review precedence order incl. stale-beats-findings).
- Staleness: BR2.1 flip when timestamp predates newest upload (counts preserved), BR2.2 native-signal
  precedence for plan/review (BR2.1 not applied), BR2.3 self-heal on the next pass, and the
  newest-upload-timestamp-absent case (BR2.1 skipped).
- BR3.1: absent/partial/malformed snapshot → `unavailable`, never throws.

### Seam 2 — ProgressAssembly hook · Jest + React Testing Library (`@testing-library/react` `renderHook`)

Mock the existing data hooks and `useCurrentOrganization`/`useOpportunityContext`; assert the produced
`ProgressStep[]`:

- Visible step set under each gating combination (Solution Plan / AI Review omitted; Required Forms
  hidden when none detected).
- Correct navigation descriptor per step (anchor section id).
- Per-step failure isolation: one hook erroring yields that step `unavailable` while the rest render
  normally.
- `latestTimestamp` is pre-computed onto snapshots from the fetched data.

### Seam 3 — ProgressBarUI presentation · Jest + React Testing Library, in `components/__tests__/`

Feed a fixed `ProgressStep[]` and assert rendering/interaction (no data layer):

- Renders four statuses + unavailable display; skeleton on loading; full empty state.
- Clicking / pressing Enter on a step activates its navigation descriptor (assert the handler is called
  with the descriptor; scroll can be spied).
- Accessibility: labeled `nav` landmark ("Package preparation progress"), one tab stop per step, status
  text present (not color-only).
- Details popover opens on its affordance, closes on Escape, returns focus.
- Condensed and mobile variants show the current step's name/count and overall "K of N".

### Prior art

- Backend/hook Jest patterns and RTL usage: `apps/web` existing component tests under
  `components/**/__tests__/` (e.g. the new `opportunity-attachments.test.tsx`,
  `disabled-reason-tooltip.test.tsx`) and `features/solution-plan/components/__tests__/SolutionPlanPanel.test.tsx`.
- Pure-function table-driven tests: `packages/core` Vitest schema tests and any existing
  `features/*/lib/*.test.ts` status helpers (e.g. `features/solution-plan/lib/status.ts`).

## Out of Scope

- Building the question-extraction / answer-generation steps ("Extracting questions", "120 of 125
  answered", navigation to the questions page). The bar is *designed for* them (generic navigation
  descriptor + additive `StepId`) but they are a future initiative.
- Related RFPs and Post-Award as progress-bar steps (they remain page sections reachable by scrolling).
- Any backend change: no new endpoint, no schema change, no new persisted entity (ADR-001, ADR-005).
- Replacing the `data-doc-status` DOM-marker polling with data-driven polling (noted tech debt; a
  cross-cutting refactor beyond this scope — the bar must simply not break the existing contract).
- Quantified success-metric instrumentation / reporting.
- Per-user bar preferences persistence.

## Further Notes

- **Resolved risk:** the domain-design and units-generation reviews flagged one open architectural
  risk — whether Required Forms / RFP Documents / Submission expose timestamps for client-side staleness
  comparison (ADR-002). The codebase scan confirms **all seven domains expose usable timestamps**
  (`createdAt`/`updatedAt`, or `generatedAt`/`submittedAt` for submission), and two domains expose
  **native server-computed staleness** (`solution plan.isStale`, `compliance review.stale`) which are
  preferred over recomputation. The only response lacking a timestamp is the bare submission *readiness*
  response, but its sibling compliance report carries `generatedAt`. The staleness design is therefore
  fully feasible as specified.
- **Org flags location:** unlike what a naive reading of the opportunity context suggests,
  `enableSolutionPlan` / `enableComplianceReview` are on the **organization** object
  (`useCurrentOrganization()`), not the opportunity context — the bar must read both sources.
- **House conventions to honor:** SWR + feature-sliced design; Shadcn UI primitives (no raw HTML
  buttons); skeleton loading (no spinners); `const` arrow functions; no `any`; string-union/`z.enum`
  over TS enums; barrel exports; `'use client'` on interactive components/hooks.
- **Provenance:** full ideation/inception artifacts live under
  `aidlc/spaces/default/intents/260828-opportunity-progress-bar/` (requirements FR1–FR5/NFR1–NFR5,
  ADR-001…ADR-005, component catalogue, u1 functional design with rules BR1.1–BR3.1). This spec is the
  standalone, implementation-ready synthesis of those; AI-DLC is not required to build from here.
