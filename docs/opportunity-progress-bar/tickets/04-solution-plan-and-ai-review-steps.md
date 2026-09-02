# 04 — Solution Plan + AI Review steps live (native staleness)

**What to build:** The two steps that use **native server-computed staleness signals** go
live. Solution Plan shows a status word (Not started / Generating / Draft / Ready) and,
when Ready but `isStale`, flips to Needs attention (detail preserved as "Ready", reason =
stored `staleReason` or "Outdated — new solicitation uploaded"). AI Review follows an
explicit precedence chain and shows the open-blocking-findings count. These two steps are
the hardcoded native-signal family — the uniform re-upload staleness layer (ticket 06) is
deliberately **not** applied to them; their native signal decides staleness.

**Blocked by:** 01 — Scaffold + Solicitations step live.

**Status:** ready-for-agent

- [ ] Solution Plan rule: not-started when no plan; in-progress while GRILLING/GENERATING_SOT (detail "Generating"; intermediate draft states → "Draft"); READY + `isStale` → needs-attention (detail "Ready", reason from `staleReason` or default); READY + not stale → complete ("Ready")
- [ ] AI Review rule precedence (first match wins): no run → not-started; latest run RUNNING → in-progress ("Running"); run stale (native `stale`, wins even over open findings) → needs-attention (detail = open-findings count if any else "Ready", reason "Outdated — review predates latest changes"); any blocking-severity finding neither resolved nor dismissed → in-progress (detail = open-findings count); else complete ("No open findings")
- [ ] Open blocking findings computed as findings minus resolved/dismissed decisions by `fingerprint`
- [ ] Both steps read their existing hooks; both consume the **native** staleness signal — do not recompute staleness for these two
- [ ] Both degrade to `unavailable` (never throw) on absent/partial/malformed snapshots, isolated from other steps
- [ ] Tests: table-driven rule tests for both, including AI-review precedence ordering (stale-beats-findings) and Solution Plan `isStale` → needs-attention with preserved "Ready" detail
