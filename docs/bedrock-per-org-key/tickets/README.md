# Per-Org Bedrock API Key — Tickets

Tickets derived from `docs/specs/bedrock-per-org-key-SPEC.md` and the ADRs in
`docs/adr/bedrock-per-org-key/`. Read the spec and ADRs first — where a ticket and an ADR
disagree, the ADR wins.

Each ticket cuts a narrow-but-complete path and lists the tickets that block it. Work the
frontier: any ticket whose blockers are all done is startable. `01` and `05` have no blockers
and can start in parallel.

## Dependency map

```
01 (core schema) ─→ 02 (backend set/get) ─→ 03 (frontend card) ─→ 04 (save probe)
                                                                      │
05 (expand orgId) ─┬─→ 06 (migrate sync sites) ───────────────┐      │
                   ├─→ 07 (migrate compliance/tool-loop) ──────┤      │
                   └─→ 08 (migrate async workers, P3 spike) ───┤      │
                                                               ↓      ↓
                                        09 (flip: per-org resolution + cache + retry;
                                            make orgId required; retire shared read)
                                             ├─→ 10 (AI-not-configured UX, sync)
                                             ├─→ 11 (AI-not-configured UX, async)
                                             └─→ 12 (IAM + retire shared SSM param)
```

`09` is the behavior flip and the point at which an org with no key goes dark. It compiles only
once every call site (06/07/08) passes `orgId`, and it depends on the config store (04) for the
per-org fallback model.

## Operational prerequisites (NOT numbered code tickets — track to completion out of band)

These are scheduled in the spec (P1 and the deploy runbook) but are operational, not code. They
**gate the deploy of `09`/`12` to any shared environment** — do them before, not after.

- **P1 — Dev / test / CI key provisioning.** Retiring the shared key takes internal environments
  dark too. Before `09`/`12` deploy: decide who owns the internal test-org Bedrock key and where
  it lives, then provision a valid per-org key (via the `02`/`04` set endpoint) for every
  dev/test/CI fixture org that exercises AI — otherwise local dev, backend AI tests against a real
  backend, and the compliance-review e2e suite all fail with "AI not configured." Update those
  fixtures/global-setup to configure the fixture org's key.
- **Deploy runbook.** Migration is coordinated and breaking (ADR-002): every existing org is dark
  until it configures a valid key. Sequence the deploy with customer + internal key configuration;
  smoke-test each AI surface per org after cutover.
