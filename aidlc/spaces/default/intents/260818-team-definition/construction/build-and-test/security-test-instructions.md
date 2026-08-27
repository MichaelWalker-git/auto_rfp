# Security Test Instructions — Team Definition

Generated because security-shaped NFRs exist (NFR3 data protection / org scoping, FR5 permissions) under the Standard strategy. Perspective: security engineer supporting the quality lead. Sources: `requirements.md` NFR3/FR5.1/FR5.2 and the per-unit `code-summary.md` files.

## Threat Surface of This Feature (STRIDE-scoped)

| Surface | Threats | Control |
|---------|---------|---------|
| Employee CRUD endpoints (U1) | Elevation (member edits pool), cross-org read (IDOR) | `employee:*` permission strings (admins manage, members view); org-prefixed SK keys |
| Import trigger (U2) | DoS via repeated runs; prompt injection via CV text | Single-run guard; extraction output validated against Zod schema before write |
| Team endpoints (U3) | Elevation (proposal permissions), tampering with plan team | Existing solution-plan permissions (`proposal:read`/`proposal:create`); Zod `superRefine` line-shape validation |
| Generate document + SAVED TEAM block (U4) | Information disclosure (cross-org CV text), invented personnel | Org-scoped document lookups; no-invention prompt rule + existing content validation |

## Checks & How to Run

1. **Permission gating (FR5.1/FR5.2)** — pinned by handler tests. Re-verify statically:
   ```bash
   grep -rn "requirePermission" apps/functions/src/handlers/employee/ apps/functions/src/handlers/solution-plan/ apps/functions/src/handlers/rfp-document/generate-document.ts
   ```
   Expect: every employee handler carries an `employee:*` permission; team handlers carry `proposal:*`; generate-document carries `proposal:create`.
2. **Org scoping (NFR3)** — pinned by helper tests (org-prefixed SK, `orgId` from request never from JWT). Re-verify statically:
   ```bash
   grep -rn "event.auth" apps/functions/src/handlers/employee/ apps/functions/src/handlers/solution-plan/*plan-team*
   ```
   Expect: no orgId sourced from auth context.
3. **Secrets hygiene** — no new credentials or endpoints; Bedrock reached only through the existing HTTP client:
   ```bash
   grep -rn "client-bedrock-runtime" apps/functions/src/helpers/team-matching.ts apps/functions/src/helpers/employee-import-engine.ts apps/functions/src/helpers/team-qualifications-context.ts
   ```
   Expect: no direct SDK import.
4. **Dependency scan** — no new dependencies were added by the four units (verify via `git diff` on the lockfile); run the repo's normal `pnpm audit --prod` cadence.
5. **Prompt-injection posture (U2/U4)** — CV text is untrusted input flowing into prompts. Mitigations in place: extraction output must parse against the employee Zod schema (malformed → categorized failure, not a write); TEAM_QUALIFICATIONS output rides the existing no-invention content validation. Residual risk: adversarial CV text steering generated prose — acceptable for org-internal documents; revisit if CVs ever come from outside the org boundary.
6. **PII handling (NFR3)** — employee records and CV text are tenant data: org-prefixed keys, no cross-org query path, CV text never logged (verify no `console.log` of document text in `employee-import-engine.ts` / `team-qualifications-context.ts`).

## SAST / DAST

- SAST: ESLint (incl. security-relevant rules) runs in CI on every PR — the four units introduce no new lint suppressions.
- DAST: no new public attack surface (all new routes behind Cognito + RBAC); the org's standard staging DAST cadence applies unchanged.

## Pass/Fail Gate

All six checks above pass = security-test PASS for this feature. Any cross-org read path, missing permission middleware, or direct Bedrock SDK import = FAIL, fix before release.
