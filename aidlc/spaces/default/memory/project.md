# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> Use sparingly: most teams don't need a project layer. Reach for it
> only when this specific project needs stable, durable guidance beyond the
> team practice (for example, package-specific release checks or an additional
> regression suite for a legacy component).

## Way of Working

<!-- Project-specific specialisation. Example: -->
<!-- This monorepo requires package-scoped branch names and a package owner -->
<!-- review in addition to the team's normal merge policy. -->

## Walking Skeleton

<!-- Project-specific specialisation. Example: -->
<!-- The walking skeleton must exercise the legacy service adapter as well -->
<!-- as the new service boundary. -->

## Testing Posture

<!-- Project-specific specialisation. -->

## Deployment

<!-- Project-specific specialisation. -->

## Code Style

<!-- Project-specific specialisation. -->

## Tech Stack

<!-- Technology choices locked for this project. -->

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->
<!-- Example: NEVER throw exceptions across service layer boundaries (affirmed 2026-05-17) -->

NEVER use the `any` type. Always use proper types, `unknown` with type guards, or specific type assertions (e.g., `as DocumentDBItem`). (Source: `.claude/rules/02-typescript-best-practices.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER define domain types manually — all types must be inferred from Zod schemas. (Exception: Infrastructure-specific types like `DocumentDBItem` that extend core types with DynamoDB keys.) (Source: `.claude/rules/02-typescript-best-practices.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER put business logic in Lambda handlers — handlers are thin (parse → validate → call helper → return). Business logic lives in `apps/functions/src/helpers/`. (Source: `.claude/rules/RULES.md`, `.claude/rules/04-backend-architecture.md`) (affirmed 2026-08-27)
NEVER import `@aws-sdk/client-bedrock-runtime` directly from Lambda handlers or helpers. All AI/Bedrock invocations must go through the HTTP-based client (`src/helpers/bedrock-http-client.ts`). (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER construct DynamoDB sort key strings manually — use SK builder helper functions only. Never use magic strings for PK values — use the `PK` constants object. (Source: `.claude/rules/RULES.md`, `.claude/rules/05-dynamodb-design.md`) (affirmed 2026-08-27)
NEVER use TypeScript enums. Use `z.enum([...])` or const maps instead. (Source: `CLAUDE.md`) (affirmed 2026-08-27)
NEVER use `.js` extensions in import paths. Use `moduleResolution: "bundler"` in tsconfig. (Source: `CLAUDE.md`) (affirmed 2026-08-27)
NEVER use the legacy DTO naming convention (`CreateXxxDTO`, `UpdateXxxDTO`, `CreateXxxSchema`, `UpdateXxxSchema`). Use the new pattern: `<Entity>CreateRequest`, `<Entity>UpdateRequest`, `<Entity>CreateRequestSchema`, `<Entity>UpdateRequestSchema`. (Source: `.claude/rules/03-entity-definitions.md`) (affirmed 2026-08-27)
NEVER redefine `<Entity>DBItem` types in `apps/functions/src/types/` by extending `& DBItem`. The authoritative `<Entity>DBItem` schema must live in `packages/core` and use the computed `[PK_NAME]`/`[SK_NAME]` keys. (Source: `.claude/rules/03-entity-definitions.md`) (affirmed 2026-08-27)
NEVER use `parsed.success` / `parsed.data` patterns. Always destructure `safeParse` immediately: `const { success, data, error } = Schema.safeParse(raw)`. (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER read `orgId` from JWT token claims or `event.auth`. It must come from the request body, query string, or path parameter. (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER use raw DynamoDB SDK commands (`PutCommand`, `GetCommand`, `QueryCommand`, etc.) in Lambda handlers. Use helpers from `@/helpers/db` or domain-specific helpers. (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER put API calls, business logic, or routing in frontend feature components — components are pure presentation. Logic lives in `features/<feature>/hooks/`. (Source: `.claude/rules/06-frontend-architecture.md`) (affirmed 2026-08-27)
NEVER import from internal feature paths — use the barrel export (`features/<feature>/index.ts`). (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER define domain types inline in frontend components — import from `@auto-rfp/core`. (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER use manual `useState` for form fields — use react-hook-form `register()` and `zodResolver`. (Source: `CLAUDE.md`, `.claude/rules/06-frontend-architecture.md`) (affirmed 2026-08-27)
NEVER use raw HTML elements (`<button>`, `<input>`, `<select>`, etc.) for interactive UI in the frontend. Use Shadcn UI components. (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER use spinners or "Loading..." text for loading states. Use skeleton components. (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
NEVER test the middy-wrapped handler unless verifying middleware behavior. Test the exported business function directly. (Source: `.claude/rules/09-testing.md`) (affirmed 2026-08-27)
NEVER hardcode dates in test assertions. Use `expect.any(String)` for timestamp fields. (Source: `.claude/rules/09-testing.md`) (affirmed 2026-08-27)
## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->
<!-- Example: ALWAYS use Result<T,E> for fallible operations in service layer (affirmed 2026-05-17) -->

ALWAYS infer types from Zod schemas using `z.infer<typeof Schema>` — never define domain types manually. (Source: `.claude/rules/02-typescript-best-practices.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS use `const` arrow functions for all function definitions — never the `function` keyword. (Exception: `export default function` for Next.js page/layout files, which the framework requires.) (Source: `.claude/rules/02-typescript-best-practices.md`) (affirmed 2026-08-27)
ALWAYS destructure `safeParse` results immediately: `const { success, data, error } = Schema.safeParse(raw)` — never access `.success` or `.data` via an intermediate variable. (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS read `orgId` from the request itself (body, query params, or path parameter) — never from JWT token claims or `event.auth`. (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS use `apiResponse()` from `@/helpers/api` for all REST handler responses — never construct raw `{ statusCode, headers, body }` objects inline. (Note: WebSocket handlers return plain `{ statusCode, body }` directly — `apiResponse` is for REST only.) (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS use DynamoDB helper functions from `@/helpers/db` or domain-specific helpers for all database operations — never use raw AWS SDK commands (`PutCommand`, `QueryCommand`, etc.) in Lambda handlers. (Source: `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS keep Lambda handlers thin: parse event → validate with Zod → call helper → return response. Business logic lives in `apps/functions/src/helpers/` — never in handlers. (Source: `.claude/rules/RULES.md`, `.claude/rules/04-backend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS wrap REST Lambda handlers with `withSentryLambda` and use the middy middleware stack in the fixed order: `authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware`. (Source: `CLAUDE.md` "Architecture", verified pervasively in `handlers/solution-plan/`) (affirmed 2026-08-27)
ALWAYS build DynamoDB sort keys via helper functions — never construct SK strings manually. PK values come from the `PK` constants object (`PK.USER`, `PK.ORGANIZATION`, etc.) — never use magic strings. (Source: `.claude/rules/RULES.md`, `.claude/rules/05-dynamodb-design.md`) (affirmed 2026-08-27)
ALWAYS co-locate test files with the source file being tested (e.g., `create-foo.ts` → `create-foo.test.ts` in the same directory). (Source: `.claude/rules/09-testing.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS write tests for every new handler, helper, or component — never generate code without also generating or updating its test file. (Source: `.claude/rules/09-testing.md` "Core Principle") (affirmed 2026-08-27)
ALWAYS test the exported business function directly — never test the middy-wrapped handler unless you need to verify the middleware stack itself. (Source: `.claude/rules/09-testing.md`) (affirmed 2026-08-27)
ALWAYS mock middy and AWS SDK clients before importing handler code in test files. (Source: `.claude/rules/09-testing.md`) (affirmed 2026-08-27)
ALWAYS include tests for every new handler covering: happy path, validation (400 with error details), not-found (404), guard clauses (business rules), DynamoDB call assertions (correct table/keys/expressions), and edge cases (optional fields, empty arrays). (Source: `.claude/rules/09-testing.md` "What to test for every handler") (affirmed 2026-08-27)
ALWAYS define an explicit CloudWatch Log Group in CDK for every Lambda with controlled retention (2 weeks for non-prod, `INFINITE` for prod). (Source: `.claude/rules/RULES.md`, `.claude/rules/04-backend-architecture.md`, `.claude/rules/07-infrastructure.md`) (affirmed 2026-08-27)
ALWAYS use Shadcn UI components from `@/components/ui/` for buttons, inputs, cards, etc. — never use raw HTML elements for interactive UI. (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS use skeleton components (`<Skeleton>`, `PageLoadingSkeleton`) for loading states — never use spinners or "Loading..." text. (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS keep frontend feature components pure presentation — no API calls, business logic, or routing. Logic lives in `features/<feature>/hooks/`. (Source: `.claude/rules/06-frontend-architecture.md` "Feature Modules", `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS import feature components/hooks through the barrel export (`features/<feature>/index.ts`) — never import from internal feature paths. (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS import domain types from `@auto-rfp/core` in frontend code — never define domain types inline in components. (Source: `.claude/rules/06-frontend-architecture.md`, `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS use react-hook-form with `@hookform/resolvers/zod` and Zod schemas from `@auto-rfp/core`. Use `z.input<typeof Schema>` as the form type. Use `zodResolver(Schema)` for validation. (Source: `CLAUDE.md` "Key Conventions", `.claude/rules/06-frontend-architecture.md`) (affirmed 2026-08-27)
ALWAYS use the computed key names `[PK_NAME]` and `[SK_NAME]` from `packages/core/src/constants.ts` (re-exported by `@/constants/common`) in DBItem schemas — never use the raw string literals `partition_key` or `sort_key`. (Source: `.claude/rules/03-entity-definitions.md`) (affirmed 2026-08-27)
ALWAYS define every stored entity using the 5-type pattern: `<Entity>CreateRequest`, `<Entity>UpdateRequest`, `<Entity>Item`, `<Entity>DBItem`, `<Entity>ListItem` — all exported from `packages/core/src/schemas/<entity>.ts`. (Source: `.claude/rules/03-entity-definitions.md`) (affirmed 2026-08-27)
ALWAYS rebuild `packages/core` (via `pnpm build`) after changing any Zod schema before running dependent typechecks or tests. (Source: `CLAUDE.md`) (affirmed 2026-08-27)
ALWAYS accompany any cdk-nag suppression with a documented reason in `packages/infra/cdk-nag-suppressions.ts`. (Source: `packages/infra/bin/auto-rfp-infrastructure.ts`, `packages/infra/cdk-nag-suppressions.ts` — IaC security practice affirmed by devsecops-agent) (affirmed 2026-08-27)
## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->
- Team Definition (team-definition feature): the recommended-team experience lives INSIDE the solution plan — not as a separate opportunity-level page — is modifiable there (change specific persons or roles), and shows per-person match rationale. (learned 2026-08-19) <!-- cid:intent-capture:c1 -->
- Team Definition (team-definition feature): the org-level employee page IS the general employee-management surface; no HR features beyond roles/CV data are implied for this initiative. (learned 2026-08-19) <!-- cid:intent-capture:c2 -->
- Team Definition (team-definition feature): confirmed build order is dependency-first with AI risk pulled early — employee pool page → AI CV extraction → solution-plan team definition → TEAM_QUALIFICATIONS generation; all four proto-units are Must and ship as ONE release (build order, not a release plan). (learned 2026-08-19) <!-- cid:scope-definition:c1 -->
- Team Definition (team-definition feature): AI CV extraction uses DIRECT import — the AI writes the employee list immediately and users clean it up via normal editing (no review-before-save step); human validation happens at the solution-plan modify-team flow instead. (learned 2026-08-19) <!-- cid:rough-mockups:c1 -->
- Code knowledge base (aidlc/spaces/default/codekb/auto_rfp/) covers the team-definition blast radius DEEPLY (solution plan, document generation, past-performance matching, pricing/staffing, KB/documents) and only skims the rest — its Scope of Analysis records kind: partial; widen the scan before relying on it for unrelated areas. (learned 2026-08-19) <!-- cid:reverse-engineering:c1 -->
- Team Definition (team-definition feature): the recommended team is generated AUTOMATICALLY during solution-plan generation; a user-modified team survives plan regeneration and is replaced only by an explicit team-regenerate action (FR3.1). Employee re-import merges BY NAME — update existing, add new, never delete (FR2.3). (learned 2026-08-19) <!-- cid:requirements-analysis:c1 -->
- Team Definition (team-definition feature): CV-import logic is OWNED by the EmployeePool component; reusing the existing extraction worker (new EMPLOYEE target type, direct write) is a deployment decision (ADR-004), not a component boundary. The one deliberate dependency cycle is SolutionPlan <-> TeamDefinition (ADR-005), inherent to embedding the team in the plan item. (learned 2026-08-19) <!-- cid:domain-design:c1 -->
- Domain-design catalogues in this repo declare the EXISTING components a feature extends or reads (marked existing/extended) so every dependency reference resolves against the well-formedness rules — never a NEW-only catalogue with dangling names. (learned 2026-08-19) <!-- cid:domain-design:c2 -->
- Team Definition (team-definition feature): the manual-edits-win re-import precedence uses a cv-import-owned EmployeeExtractionSnapshot record (compare current value vs last extracted) — NEVER an extension of the Employee schema; one authoritative Employee schema, owned by employee-pool. Import failure reasons: UNREADABLE, INCOMPLETE_EXTRACTION (user-facing per Q2) + EXTRACTION_FAILED, AMBIGUOUS_NAME (operational). (learned 2026-08-19) <!-- cid:functional-design:c1 -->
- Team Definition (team-definition feature): PlanTeam member lines have exactly three shapes — FILLED (employeeId + nameSnapshot), DELETED-employee (nameSnapshot + removedEmployee true, no employeeId), UNFILLED (role only, no employeeId/nameSnapshot/rationale); staffingPositionRef is an identifier reference to the staffing plan line (position unique per plan). (learned 2026-08-19) <!-- cid:functional-design:c2 -->
- Team Definition (team-definition feature): TEAM_QUALIFICATIONS context assembly classifies team lines in the fixed order UNFILLED (no employeeId+no nameSnapshot) → DELETED (removedEmployee) → FILLED (employeeId), with a defensive fallback: a FILLED line whose Employee lookup misses degrades to DELETED with a data-integrity warning — generation never fails on a stale reference. (learned 2026-08-19) <!-- cid:functional-design:c3 -->
- Notary Detection (notary-detection feature): Construction unit decomposition is 4 units — u1-notary-core-engine (library: notary schemas + NotaryDetectionEngine, AI-risk foundation), u2-notary-backend-wiring (service: schema extensions + both hook scans + mark-forms-ready rollup + notification), u3-notary-ui (ui: per-form label + card badge), u4-notary-compliance-finding (service, OPTIONAL/Could). DAG: u1→u2, u1→u3, {u1,u2}→u4; u2 and u3 are parallelizable after u1. u3 depends on u1 (build-time types) NOT u2 (u2's data reaches u3 at runtime via existing APIs). (learned 2026-08-25) <!-- cid:units-generation:c1 -->
- Notary Detection (notary-detection feature): Construction Bolt sequence is risk-first/dependency-first, one Unit per Bolt — Bolt 1 = u1 (engine, de-risk the zero-miss core), Bolt 2 = u2 (backend wiring + rollup + notification), Bolt 3 = u3 (UI), Bolt 4 = u4 (optional compliance finding, last). Construction iteration is UNIT-MAJOR (design + build each unit fully before the next; first working code after u1). Solo AI build — all Bolts run by aidlc-developer-agent (Team Formation skipped). Not a formal walking skeleton (u1 is a de-risking foundation, not an end-to-end slice). (learned 2026-08-25) <!-- cid:delivery-planning:c1 -->
- Solution Plan Versioning (solution-plan-versioning feature): the system attribution sentinel is createdBy="SYSTEM"/createdByName="System", defined ONCE as a canonical constant in packages/core next to the SolutionPlanVersion schema — every unit imports it (u1 writes, u2 lists, u4 displays); re-typing the literals anywhere is forbidden. (learned 2026-08-28) <!-- cid:nfr-design:c2 -->
- A fail-open code path that swallows its errors MUST report to Sentry explicitly inside the catch — withSentryLambda only reports unhandled errors, so swallowed failures are invisible to it (established at solution-plan-versioning NFR design, NFR1.6). (learned 2026-08-28) <!-- cid:nfr-design:c1 -->
- Expected guard rejections (400/404/409) are returned as apiResponse values — never thrown — so httpErrorMiddleware/withSentryLambda structurally cannot report them to Sentry; log them at info level at the guard site (mechanism, not convention; established at solution-plan-versioning NFR design, NFR1.14). (learned 2026-08-28) <!-- cid:nfr-design:c3 -->
- Solution Plan Versioning (solution-plan-versioning feature): at code generation, verify u1's deleteVersion helper implements record-first/body-second removal with missing-body tolerance (retry-converging) — contract C3's text does not pin this semantic explicitly; u2's design and the reviews depend on it. (learned 2026-08-28) <!-- cid:nfr-design:c4 -->
