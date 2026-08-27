# Performance Test Instructions — Team Definition

Generated because performance-shaped NFRs exist (NFR1 extraction quality, NFR2 re-run cleanliness, NFR6 async execution) even though the active test strategy is Standard; these are targeted checks, not a full load-testing program. Sources: `requirements.md` NFR1/NFR2/NFR6 and the per-unit `code-summary.md` files.

## What Matters Here

The feature's hot paths are asynchronous AI operations, not high-RPS endpoints:

| Path | Character | Concern |
|------|-----------|---------|
| CV import run (U2) | SQS worker, one Bedrock call per CV document | Stays off the request path (NFR6); progress visible; consecutive-failure abort bounds runaway runs |
| Team matching (U3) | One Bedrock call per generation/regenerate | Synchronous regenerate must stay inside the API Gateway window (~29s) |
| TEAM_QUALIFICATIONS context assembly (U4) | Pool read + ≤1 S3 text read per member, bounded by 4k/member + 24k total budgets | Prompt-size ceiling respected; assembly latency linear in team size |

## Checks & How to Run

1. **Request-path isolation (NFR6)** — code-level assertion, already pinned by tests: trigger handlers return 202 and enqueue; no Bedrock import in any REST handler path. Re-verify with:
   ```bash
   grep -rn "bedrock" apps/functions/src/handlers/employee/ apps/functions/src/handlers/rfp-document/generate-document.ts
   ```
   Expect: no direct Bedrock invocation in request handlers (only helpers used by workers, plus the plan-team regenerate route which follows the existing sync-AI route precedent at 120s/512MB).
2. **Regenerate latency envelope** — with a seeded dev stage, time `POST /solution-plan/team/regenerate` for a pool of ~50 employees and an 8-slot plan; target p95 well under 25s (shortlist-sized prompt). Manual/dev-stage check; record in the NFR matrix below when run.
3. **Context budget ceiling (U4)** — pinned by unit tests (`team-qualifications-context.test.ts` budget truncation cases): per-member CV text ≤ 4,000 chars, total SAVED TEAM block ≤ 24,000 chars.
4. **Import run scaling (NFR1/NFR2 measurement)** — extraction quality (≥90% field population) and re-run cleanliness are MEASUREMENT NFRs over a representative CV set; they require a curated CV corpus in a dev org. Procedure: seed ≥20 well-formed CVs in org documents → run "Generate from CVs" → count auto-populated fields per record → re-run and diff. Not automatable in CI today; tracked as an outstanding item in the build-and-test summary.

## NFR Target-vs-Actual Matrix

| NFR | Target | Actual | Status |
|-----|--------|--------|--------|
| NFR1 extraction quality | ≥90% fields populated (well-formed CVs) | — | PENDING (needs CV corpus, dev stage) |
| NFR2 re-run cleanliness | no manual cleanup for well-formed CVs | — | PENDING (same corpus) |
| NFR6 async execution | import + matching off the request path | verified in code + tests | PASS |
| U4 prompt budget | ≤24k chars team block | pinned by unit tests | PASS |

## Tooling

No k6/Artillery load rig is warranted at this scale (single-org admin actions, not user-facing traffic). If regenerate latency becomes a concern, wrap check 2 in a small k6 script against the dev stage.
