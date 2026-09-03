# 03 — RFP Documents step live

**What to build:** The RFP Documents step reflects real data, counting against the brief's
required-documents list when one exists ("X of Y required", complete when every required
document exists and is Ready/Approved), and falling back to "X of Y ready" over the
documents that actually exist when the brief has no required-documents list yet.

**Blocked by:** 01 — Scaffold + Solicitations step live.

**Status:** ready-for-agent

- [ ] Primary path: when the brief carries a required-documents list, detail "X of Y required" (Y = list size, X = required docs that exist and are Ready/Approved); complete when X = Y and Y > 0
- [ ] Fallback path: no required-documents list → "X of Y ready" over existing documents (Y = created, X = Ready/Approved); complete when all existing docs are ready/approved and ≥1 exists
- [ ] Required-documents list sourced from the brief's requirements section data (`RequiredOutputDocument[]`)
- [ ] Documents snapshot read from the RFP-documents hook; `latestTimestamp` pre-computed from per-doc timestamps
- [ ] Degrades to `unavailable` (never throws) on absent/partial/malformed snapshot, isolated from other steps
- [ ] Tests: table-driven rule tests covering both paths (missing required-documents list → fallback), each base status, count strings, and boundaries (empty, partial, all-ready)
