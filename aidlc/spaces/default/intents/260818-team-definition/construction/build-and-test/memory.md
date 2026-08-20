<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

- 2026-08-20T06:07:02Z — Generated performance and security test instructions despite the Standard strategy (stage prose reserves them for Comprehensive): performance-shaped NFRs (NFR1/NFR2/NFR6) and security-shaped NFRs (NFR3, FR5) exist, the stage's soft-guideline clause licenses it, and the stage's declared artifact set lists both files.
- 2026-08-20T06:07:02Z — "Integration tests" for this repo are the co-located cross-unit boundary suites run against mocked AWS clients — the repo has no separate integration harness; the boundary contract (call shapes, key construction, merge semantics) is what the combined Jest run pins.
- 2026-08-20T06:07:02Z — Web "build" verified as tsc --noEmit at the documented pre-existing baseline rather than a full Next production build; the full build runs in CI/Amplify and the type-check is the load-bearing local signal.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->

- 2026-08-20T06:07:02Z — NFR1/NFR2 (extraction quality ≥90%, re-run cleanliness) need a curated CV corpus in a dev org to measure; confirm who seeds it and when.
