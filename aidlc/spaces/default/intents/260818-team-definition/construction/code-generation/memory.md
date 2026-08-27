<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

- 2026-08-20T04:32:22Z — (team-qualifications) BR1.1 "saved team" = any persisted planTeam with ≥1 member; an auto-attached (synthesis-generated, not user-saved) team qualifies. rules.md BR1.1 logic keys on "no persisted team OR its member list is empty", not on savedAt/userModified, so the guard checks plan.planTeam presence + members.length.
- 2026-08-20T04:32:22Z — (team-qualifications) BR1.1 guard applies to BOTH generate-document paths (new document and regenerate-into-existing). The rule triggers on "TEAM_QUALIFICATIONS generation requested"; the ADR-10 grandfathering carve-out in the handler is specific to the solution-plan gate, not to this precondition.
- 2026-08-20T04:32:22Z — (team-qualifications) Worker-time missing team (race: team emptied between request and SQS delivery) is out of BR1.1's scope — the no-FAILED-run guarantee is a request-time property. The worker fails the run with a clear generationError instead of generating ungrounded content.
- 2026-08-20T04:32:22Z — (team-qualifications) BR2.1 keeps the existing TEAM_QUALIFICATIONS KB budget untouched; grounding exclusivity is enforced by the prompt (personnel exclusively from the SAVED TEAM block; KB remains legitimate for corporate capabilities/certs, not personnel). Avoids a behavioural regression in context budgeting.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

- 2026-08-20T05:19:49Z — (team-qualifications) Worker-time no-saved-team marks the run FAILED by returning normally instead of throwing; throwing would burn SQS retries on a deterministic condition, while genuine read errors still throw and retry. Slightly stronger than the plan's "mark FAILED" wording.
- 2026-08-20T05:19:49Z — (team-qualifications) CV/context budgets set to 4k chars per member and 24k total for the SAVED TEAM block (larger than the 12k SOLUTION_PLAN_TEXT_BUDGET precedent) because per-member CV excerpts are the unit's core grounding payload.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

- 2026-08-20T04:32:22Z — (team-qualifications) Context assembly reads the persisted plan.planTeam directly and does its own Employee lookups per BR2.5, rather than reusing getDerivedPlanTeam (which refreshes snapshots and derives removedEmployee for the UI). BR2.5's detection order + stale-lookup fallback is the unit's own contract; reusing the UI derivation would double-derive and hide the data-integrity warning path.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
