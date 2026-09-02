# 06 — Uniform re-upload staleness layer (BR2.1–BR2.3)

**What to build:** When a user uploads a new solicitation document after downstream steps
were already in progress or complete, every affected downstream step flips to "Needs
attention" with the reason "Outdated — new solicitation uploaded" — **preserving its
counts and underlying work, never resetting them** — so stale work is never shown as
current. The flip self-heals: once the user re-runs that step's own action and its data
updates past the newest upload, the step returns to its true status automatically (no
manual acknowledgement). Statuses are derived per evaluation pass, never persisted.

**Blocked by:** 02 (Analysis + Required Forms), 03 (RFP Documents), 04 (Solution Plan +
AI Review), 05 (Submission) — all downstream steps must exist first.

**Status:** ready-for-agent

- [ ] The newest non-deleted solicitation upload timestamp is derived from the Solicitations snapshot and passed to the rules as a pre-computed value; rules never extract timestamps from raw payloads
- [ ] BR2.1: for each downstream step, after its base status is computed, if base is in-progress or complete AND the step's `latestTimestamp` predates the newest upload → status becomes needs-attention, reason "Outdated — new solicitation uploaded", counts/detail preserved
- [ ] BR2.2: Solution Plan and AI Review are excluded from BR2.1 — their native signals decide staleness and supply the reason
- [ ] BR2.3: needs-attention is never sticky — each pass recomputes from current data, so a step self-heals once its data updates past the newest upload (or its native signal clears)
- [ ] If the newest-upload timestamp is unavailable for a pass, BR2.1 is skipped that pass (base statuses stand; native signals still apply)
- [ ] Tests: BR2.1 flip when timestamp predates newest upload (counts preserved); BR2.2 native-signal steps not flipped by BR2.1; BR2.3 self-heal on next pass; newest-upload-timestamp-absent → BR2.1 skipped. Timestamps use fixed input fixtures, never wall-clock
