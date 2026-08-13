# ADRs — AutoRFP Improvements v1

> Decisions from the grilling session on 2026-08-11. Each ADR is Accepted unless noted.
> Format: Context → Decision → Consequences. Companion to `ROADMAP-v1.md` / `TASKS-v1.md` / `GLOSSARY.md`.

---

## ADR-1 · READY is sufficient to open the generation gate (no approval step)

**Context.** The meeting flow says the user "reviews and can regenerate" the SoT, but the gate as designed only checks machine status READY — a plan nobody looked at passes.

**Decision.** No explicit APPROVED state in v1. READY (synthesis complete) unlocks document generation. Review is possible, not mandatory.

**Consequences.** Matches the speed-first strategy (10+ RFPs/day, minimal manual intervention). If a customer later demands sign-off, an APPROVED status is an additive enum value + one endpoint; nothing in v1 blocks it.

---

## ADR-2 · SolutionPlan is a mutable singleton per opportunity; regenerate wipes

**Context.** Stable id vs new-id-per-run decides whether old transcripts/S3 versions are history or garbage.

**Decision.** One plan id per opportunity, forever. Regenerate wipes grilling messages and overwrites the plan in place. No version history UI in v1. Prior S3 objects become unreachable (acceptable; version counter keeps keys from colliding — see ADR-11).

**Consequences.** Get = single `getItem`; simplest data model. Audit trail of prior runs is sacrificed in v1.

---

## ADR-3 · Freshness is an orthogonal `isStale` flag, not a status

**Context.** `STALE` inside the status enum conflates lifecycle with freshness: what does markStale do during GRILLING? Does a user edit of a STALE plan flip it to READY?

**Decision.** Status enum is `GRILLING | GENERATING_SOT | READY | FAILED`. Add `isStale: boolean` + `staleReason`. `markSolutionPlanStale()` is a **no-op unless status is READY**. Gate checks status only; the banner checks `isStale`. User save or regenerate clears the flag.

**Consequences.** No ambiguous transitions; supersedes the roadmap's `STALE` enum value. Schema (T4), gate (T9), and frontend badge (T10/T13) must follow this shape.

---

## ADR-4 · Warn, then discard user edits on regenerate

**Context.** `isUserEdited=true` + Regenerate: are hand edits recoverable?

**Decision.** Confirmation dialog states edits will be discarded; on confirm, they are gone. No archived copy, no restore path in v1.

**Consequences.** Consistent with wipe-on-regenerate (ADR-2). The dialog copy must be explicit ("your manual edits will be permanently lost").

---

## ADR-5 · `runId` token prevents zombie rounds

**Context.** With a stable id and wipe-and-re-enqueue, an in-flight worker from the previous run can append messages into a freshly wiped transcript and enqueue its own next round.

**Decision.** `init` stamps a fresh `runId` (ulid) on the plan; every SQS message carries it; the worker loads the plan first and **no-ops when `message.runId ≠ plan.runId`**. Additionally, init while status is GRILLING/GENERATING_SOT requires an explicit restart intent (UI confirmation) rather than being silently accepted.

**Consequences.** Adds `runId` to the plan schema (T4), the queue message (T6), and the idempotency check (redelivery skip becomes: same runId AND GRILLER message for round exists).

---

## ADR-6 · Constrain synthesizer output; truncation is a logged safety net

**Context.** SoT text is hard-truncated to 12k chars at injection; the cost-drivers section (typically last) would be the casualty of an overshoot — in the very document that "OVERRIDES" everything.

**Decision.** Synthesizer prompt targets ~10k chars of body text. Injection keeps the 12k hard truncation but logs a warning (with plan id + actual length) when it fires.

**Consequences.** T6 prompt requirement + T8 logging requirement. Sections stay whole in practice.

---

## ADR-7 · Generated documents stamp the SoT version they were built from

**Context.** A Technical Proposal built against plan v2 has no link to it after the user edits the plan to v3.

**Decision.** Add optional `solutionPlanId` + `solutionPlanVersion` to the RFP document item, written at generation time when a plan was injected. No UI in v1.

**Consequences.** Two optional schema fields (rfp-document schema + worker write in T8). Enables a future "built from outdated plan" badge without losing history for v1-generated docs.

---

## ADR-8 · SoT content is editable only when READY

**Context.** An unrestricted PATCH during GRILLING/GENERATING_SOT races the synthesizer's S3 upload and status flip.

**Decision.** PATCH returns 409 unless status is READY. FAILED plans are retried via re-init, not hand-edited. Invariant: content exists ⇔ editable.

**Consequences.** One guard in `update-solution-plan.ts` (T7) + a test. UI only shows Edit when READY anyway; the server enforces it.

---

## ADR-9 · LOW-confidence pricing cache entries get a short TTL (~24h)

**Context.** A global cross-org cache means one thin Brave snippet serves "no price found" to every org for 30 days.

**Decision.** TTL by confidence: HIGH/MEDIUM = 30 days, LOW = ~24 hours.

**Consequences.** One branch in the TTL computation (T2). A service with genuinely no public price re-searches daily — acceptable quota cost; still far under the free tier with the global cache.

---

## ADR-10 · Grandfather opportunities with existing gated documents

**Context.** Flipping gating on (R3) would block every in-flight opportunity from regenerating documents until a 5–10 minute grilling session runs.

**Decision.** If the opportunity already has ≥1 generated document of a gated type, the gate passes, with a nudge banner recommending a plan. New opportunities are fully gated.

**Consequences.** One extra query in the gate path (T9) + banner copy (T12). Grandfathering is now **required**, not optional.

---

## ADR-11 · `version` is monotonic across regenerations

**Context.** With wipe-on-regenerate and docs stamping `solutionPlanVersion`, a per-run version reset would make stamps ambiguous.

**Decision.** One counter, bumped by both regeneration and user save, never reset. A doc stamped v3 is unambiguously older than plan v5. S3 keys (`v{version}`) never collide.

**Consequences.** Trivial to implement; regeneration must read the current version before overwriting.

---

## ADR-12 · Permissions: `proposal:create` for writes, `proposal:read` for reads

**Context.** The plan named a permission only for init.

**Decision.** init / PATCH / regenerate require `proposal:create`; get / transcript / html-content require `proposal:read` (the project's existing read permission). No new permission strings.

**Consequences.** Matches exec-brief scoping; the RBAC matrix is untouched. Restricting SoT editing to leads would need new strings later — deliberately deferred.

---

## ADR-13 · Termination guardrails: minimum 2 rounds + token-only-line rule

**Context.** Any literal occurrence of `INTERVIEW_COMPLETE` ends the interview — including a round-1 emission or a mid-text leak ("…when done I will say INTERVIEW_COMPLETE").

**Decision.** The token is honored only (a) from round 2 onward, and (b) when it is essentially the entire message or its final line. Final round still forces termination.

**Consequences.** Two small checks in `processGrillingRound` (T6) + tests for both rejection cases.

---

## ADR-14 · Exec brief is recommended, not required, for grilling

**Context.** The Griller's context includes the exec brief, which may not exist yet.

**Decision.** init proceeds without a brief: the Griller context omits that section; `get_executive_brief_analysis` returns empty for the Tech Lead. The UI shows a "brief recommended first" nudge; nothing blocks.

**Consequences.** No new coupling between pipelines; grilling quality on brief-less opportunities depends on the solicitation alone.

---

## ADR-15 · Pricing lookup failures degrade, never fail the document

**Context.** Brave can be down, quota-exhausted, or the SSM key missing mid-generation.

**Decision.** The `search_service_pricing` executor never throws into the tool loop. Any failure (per-service or total) returns rows marked "vendor quote required (lookup unavailable)". The document always completes; prompt rules already forbid inventing a price to fill the gap.

**Consequences.** T3 executor wraps everything; tests cover total-outage and partial-failure shapes. A "generated without live pricing" warning field on documents was considered and deferred.
