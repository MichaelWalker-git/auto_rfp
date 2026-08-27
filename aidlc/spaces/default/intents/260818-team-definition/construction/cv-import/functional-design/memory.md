<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-08-19T12:29:23Z — review iteration 1 (NOT-READY) reshaped two decisions: the manual-edits-win snapshot moved from an Employee-schema extension to a U2-owned EmployeeExtractionSnapshot entity (keeps ONE authoritative Employee schema, no U1 coordination), and the failure enum grew two operational categories beyond the user's Q2 choice — EXTRACTION_FAILED (AI-service failure, with retry + consecutive-failure escalation to run FAILED) and AMBIGUOUS_NAME (multiple normalized-name matches refuse to guess). Q2's two reporting categories remain the user-facing story; the extra two are error-path completeness.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
