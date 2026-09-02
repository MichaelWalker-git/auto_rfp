# 05 — Submission step live

**What to build:** The Submission step reflects real data — showing the compliance pass
rate before submission and "Submitted" once a submission exists, so the user knows how
close the package is to submittable and when it has been submitted.

**Blocked by:** 01 — Scaffold + Solicitations step live.

**Status:** ready-for-agent

- [ ] Submission rule: a SUBMITTED submission exists → complete ("Submitted"); else in-progress when compliance checks have run (detail = pass rate); else not-started when nothing has run
- [ ] Snapshot read from the compliance-report + submission-history hooks; `latestTimestamp` pre-computed from report `generatedAt` / submission `submittedAt`/`updatedAt` (the bare readiness response lacks a timestamp — use the sibling report's `generatedAt`)
- [ ] Degrades to `unavailable` (never throws) on absent/partial/malformed snapshot, isolated from other steps
- [ ] Tests: table-driven rule tests for each base status (not-started, in-progress with pass rate, complete/Submitted)
