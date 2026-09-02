# Notary Detection — Session Handoff

> Handoff + full-context summary for the AI-DLC `notary-detection` workflow, so a fresh session (or a fresh
> clone) has everything it needs. **Resume with `/aidlc --resume`.**
>
> Written 2026-08-25, updated 2026-08-27. Intent record: `aidlc/spaces/default/intents/260821-notary-detection/`.
>
> **Git note (2026-08-27):** the per-intent AI-DLC bookkeeping (`aidlc/spaces/*/intents/` — questions files,
> per-stage artifacts, audit shards, state) is now **untracked / local-only** (see `.gitignore`). This doc is the
> durable record in git. On the machine that ran the workflow the intent record still exists on disk and
> `/aidlc --resume` works; on a fresh clone there is no resumable workflow state — finish remaining work as
> normal development guided by this doc, or start a fresh intent.

## TL;DR — the single next action

The workflow is **parked** in Construction (feature scope, **unit-major** iteration). **u1, u2, and u3 are all
complete: designed, code-generated, adversarially reviewed READY, and unit-completed** (u3 code-generation
UNIT_COMPLETED 2026-08-26).

**On resume:** `/aidlc --resume` → choose **Resume** at the menu. The next pending work is the **u4 decision**:
u4-notary-compliance-finding is OPTIONAL / Could — ask the user whether to build or de-scope it, then either run
its full unit-major cycle or skip it and proceed to **build-and-test** (3.6).

> Note: the resume marker / Current Stage may read `functional-design` — that is the unit-major cursor lagging;
> act on the directive's own `directive.stage` + `directive.unit`, not the state file's Current Stage. Also
> expect the late **gate cascade**: under unit-major, the per-stage human approval gates fire at the end of the
> Construction block once the whole (stage × unit) grid is settled.

## What is DONE and green

| Unit | Stages complete (all reviewed READY) | Code / tests |
|---|---|---|
| **u1-notary-core-engine** (library) | functional-design, nfr-requirements, nfr-design, infrastructure-design, **code-generation** | ✅ built + green — 17 core schema tests + 37 engine tests |
| **u2-notary-backend-wiring** (service) | functional-design, nfr-requirements, nfr-design, infrastructure-design, **code-generation** | ✅ built + green — core suite 1065; functions scoped 94 |
| **u3-notary-ui** (ui) | functional-design, nfr-requirements, nfr-design, infrastructure-design, **code-generation** | ✅ built + reviewed READY — pure `lib/notary-ui.ts` helpers + Jest/RTL/XSS tests |

- **u1** shipped: `packages/core/src/schemas/notary.ts` (schemas + `statusSeverity`) and
  `apps/functions/src/helpers/notary-detection.ts` (the `NotaryDetectionEngine`) + `constants/notary.ts`, with
  co-located tests. Zero-miss verified across all failure paths.
- **u2** shipped: schema extensions on `required-form.ts` / `opportunity.ts` / `notification.ts` (+ `notary.ts`
  `NotaryClassificationSource` + `notaryUnmappedTriggers` on `OpportunityItem`), the `notary-wiring.ts` helper,
  and wiring in `detect-required-forms.ts`, `textract-forms-callback.ts`, `mark-forms-ready.ts`. Two review
  cycles closed a real zero-miss gap (unmapped body triggers on mixed opportunities now persist at the
  opportunity level and fold into the rollup).
- **u3** shipped (2026-08-26): `apps/web/features/required-forms/lib/notary-ui.ts` (pure status→visual helpers),
  `NotaryBadge` (per-form amber/yellow Shadcn badge with keyboard-operable expand), `NotaryTriggerList`
  (evidence rows, XSS-safe text nodes), `OpportunityNotaryChip` (card-footer rollup); wired into
  `RequiredFormsList.tsx` (inside a `data-row-actions` guard) and `opportunity-item-card.tsx` (badge-wrapper
  condition widened to include `notarySummary?.anyNotaryRequired`); barrel exports + Jest/RTL/XSS/aria tests.
  Read-only — no new API, hook, fetch, or mutation.

## What REMAINS (in order)

1. **u4-notary-compliance-finding** (service) — **OPTIONAL / Could** (FR9.1: a `NOTARY_REQUIRED` compliance-review
   finding reading the stored classification). Confirm with the user whether to build or de-scope. Two-enum
   gotcha: add `NOTARY_REQUIRED` to BOTH the core `ComplianceIssueTypeSchema` and the engine's inline raw-finding
   enum. Full unit-major cycle (functional-design → … → code-generation).
2. **Build and Test** (3.6), then **CI Pipeline** (3.7) — run once after all units (quality-agent lead).
3. **Operation phase** stages (feature scope runs all 33) — as the engine emits them.
4. The **gate cascade**: under unit-major, the per-stage human approval gates fire LATE, in a cascade at the end
   of the Construction block once the whole (stage × unit) grid is settled. Also, the **walking-skeleton gate +
   ladder prompt** (autonomy mode) is expected around the first Bolt's completion — watch for `gate: true` /
   `gate: "unresolved"` directives and handle per the SKILL.

## How to run the workflow (mechanics for the resuming session)

- Driven by the forwarding loop: `bun .claude/tools/aidlc-orchestrate.ts next` → act on the directive → for a
  gated stage-work outcome `... report --stage <slug> --result <outcome>`; per-unit stages use `gate:false` and
  `aidlc-state.ts unit start/complete` instead of report-approve; re-run `next`.
- **Per-unit stage ritual** (what each stage above follows): read inline context → questions file + interaction
  mode (`aidlc-log.ts decision`/`answer`) → **pre-generation summary confirmation** (`aidlc-log.ts decision/answer
  --checkpoint summary-confirmation`) → `unit start` → generate artifacts → **adversarial reviewer** → `unit
  complete` → `next`.
- **Reviewer pattern** (per unit, `aidlc-architecture-reviewer-agent`): write
  `<record>/.aidlc-reviewer-dispatch.json` (`{reviewer,stage,unit,exempt:[consumes+stage-file+Q&A+relevant code
  paths]}`) → `aidlc-log.ts review --stage <s> --reviewer aidlc-architecture-reviewer-agent --iteration <n>
  --unit <u>` → `Task(aidlc-architecture-reviewer-agent)` (it appends a `## Review` section with a `READY`/
  `NOT-READY` verdict line to the primary artifact) → read verdict → `rm` the dispatch record → `aidlc-log.ts
  review … --iteration <n> --verdict <READY|NOT-READY> --unit <u>`. On NOT-READY (adversarial, max 2 iterations):
  delete the stale `## Review` section, fix, re-dispatch iteration 2.
- **Code-generation** is `mode: subagent`: Step 3 **Plan Approval is a mandatory human hard-stop** (already
  satisfied for u3). Step 4 dispatches `Task(aidlc-developer-agent)` with the marker `AIDLC-UNIT: <unit>` as the
  first line + the approved plan + design-artifact paths + the steering bundle. The orchestrator (not the
  developer) writes `code-summary.md` / `traceability.json` and owns the reviewer + lifecycle.

## Gotchas learned this run

- **CWD drift:** running `cd apps/functions` (etc.) in a Bash call persists; subsequent `bun .claude/tools/...`
  with a relative path fails ("Module not found"). Use absolute tool paths or `cd /c/aim_projects/rfp/auto_rfp`
  first (or run `cd` in a subshell).
- **HUMAN_TURN hook fix (already applied):** `.claude/settings.json` was missing a `PostToolUse` →
  `AskUserQuestion` binding for `aidlc-record-human-turn.ts`, so answering a question *widget* did not record a
  human turn and the mandatory pre-generation/summary receipts were refused. A `PostToolUse` matcher scoped to
  `AskUserQuestion` was added (loads at session start; active). Keep it. Without it, `aidlc-log.ts answer
  --checkpoint …` and the gates refuse unless the user *types* a message.
- **Jest 30 test flag:** use `pnpm test --testPathPatterns '<regex>'` (plural, no extra `--`) in `apps/functions`.
- **Scoped test commands:**
  - core: `pnpm --filter @auto-rfp/core test -- src/schemas/<file>.test.ts`
  - functions: `cd apps/functions && pnpm test --testPathPatterns 'notary-wiring|detect-required-forms|textract-forms-callback|mark-forms-ready'`
  - web (u3, when built): `cd apps/web && pnpm test -- notary-ui NotaryBadge NotaryTriggerList OpportunityNotaryChip`
- **Reviewers run adversarially and DO catch real issues** — u2 code-gen and u2 nfr-design each needed a fix
  cycle; do not treat READY as automatic.

## Key design facts (so the resuming session stays consistent)

- **Zero-miss (NFR1) is the hard bar.** Every failure path degrades to `POSSIBLY_REQUIRED`, never a silent
  `NOT_REQUIRED`. Bedrock only via the u1 engine → the HTTP client; model id inherits the stack default (never
  pinned). Best-effort/never-throw into the intake pipeline (NFR3). No new infrastructure (NFR4) — every unit is
  embedded in the existing monorepo/pipeline, which is why each unit's infrastructure-design was a documented
  no-op.
- **u3 is read-only:** renders u2's fields (`RequiredForm.notaryStatus`/`notaryRequirements`,
  `OpportunityListItem.notarySummary`) from existing SWR hooks; XSS-safe via React JSX escaping (no
  `dangerouslySetInnerHTML`); WCAG 2.1 AA (icon+text, aria, keyboard). Its security reqs are `SEC.1`/`SEC.2`
  (construction-specific, no inception parent); NFR7.1 = accessibility, NFR6.1 = testability.
- **u4 is OPTIONAL** — the delivery plan marks it Could; confirm scope before building.

## Where things live

- Intent record (**local-only, not in git** — see the git note at the top):
  `aidlc/spaces/default/intents/260821-notary-detection/`
  - `construction/<unit>/<stage>/` — per-unit stage artifacts (questions, specs, traceability, code-summary).
  - `inception/…` — requirements, units-generation, domain-design (the upstream contracts).
  - `audit/<host>-<clone>.md` — the audit shard (all events).
- Shipped code (in git): `packages/core/src/schemas/notary.ts` (+ extended `required-form.ts`/`opportunity.ts`/
  `notification.ts`); `apps/functions/src/helpers/notary-detection.ts`, `notary-wiring.ts`; wired handlers under
  `apps/functions/src/handlers/…`; u3 frontend under `apps/web/features/required-forms/` (`lib/notary-ui.ts`,
  `NotaryBadge`, `NotaryTriggerList`) and `apps/web/components/opportunities/` (`OpportunityNotaryChip`).
- Original plan (adopt-base, mostly implemented): `docs/NOTARY-DETECTION-IMPLEMENTATION.md`.
- Status any time: `bun .claude/tools/aidlc-orchestrate.ts next --status` or `/aidlc --status`.
