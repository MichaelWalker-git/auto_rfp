<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->


- 2026-08-19T12:29:23Z — review iteration 1 (NOT-READY) reshaped two decisions: the manual-edits-win snapshot moved from an Employee-schema extension to a U2-owned EmployeeExtractionSnapshot entity (keeps ONE authoritative Employee schema, no U1 coordination), and the failure enum grew two operational categories beyond the user's Q2 choice — EXTRACTION_FAILED (AI-service failure, with retry + consecutive-failure escalation to run FAILED) and AMBIGUOUS_NAME (multiple normalized-name matches refuse to guess). Q2's two reporting categories remain the user-facing story; the extra two are error-path completeness.
<!-- aidlc-wave-memory:cv-import:c16c8ea40675d1d24e0f8328971e98c09158af16a97b230167d1e141f571922f -->

- 2026-08-19T12:43:31Z — review iteration 1 (NOT-READY) fixed: nameSnapshot made optional with explicit line-shape constraints (FILLED / DELETED-employee / UNFILLED), and staffingPositionRef typed as an identifier reference to StaffingPlanLine (position unique per staffing plan).
<!-- aidlc-wave-memory:plan-team:6edaa2be591f58f87b7152b6c55cbd915bd2f6ee8ff60280d188b7e59c76c76c -->

- 2026-08-19T13:03:40Z — review iteration 1 (NOT-READY) fixed by adding BR2.5: an explicit line-shape detection order over U3's TeamMember fields (UNFILLED → DELETED → FILLED) plus a defensive stale-reference fallback (a FILLED lookup miss degrades to DELETED with a data-integrity warning). This also insulates U4 from U3's still-open removedEmployee maintenance question — U4 never fails on a stale flag.
<!-- aidlc-wave-memory:team-qualifications:a7141a171c4f383258f8eeff3cad1f3592b735a75f7dcff179d0d8e4433f39ab -->
## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
