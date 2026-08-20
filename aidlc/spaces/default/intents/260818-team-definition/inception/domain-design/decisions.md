# Architecture Decision Records — Team Definition Domain Design

Decisions recorded from the confirmed answers in `domain-design-questions.md` (Q1–Q5), grounded in requirements.md and the code knowledge base (architecture.md, component-inventory.md).

## ADR-001: Two new components — EmployeePool and TeamDefinition

- **Context** — The feature spans org-level reference data (employees) and per-opportunity plan behavior (team matching, persistence, documents). Boundaries had three viable cuts (Q1).
- **Decision** — Two new components: EmployeePool (employee CRUD + AI CV import) and TeamDefinition (matching + PlanTeam lifecycle). (Q1: A)
- **Consequences** — Positive: each block has one data owner and one change driver; extraction and pool share the Employee entity without a cross-boundary hop; team logic evolves with the solution plan. Negative: the import flow inside EmployeePool makes that component larger than a pure CRUD block.
- **Alternatives Rejected** — Three-way split (separate CvExtraction block): cut a single user flow in half and forced a shared-entity boundary. Single "personnel" block: coupled org reference data to opportunity-scoped plan logic with different lifecycles and permissions.
- **Security/compliance** — Employee data (CV-derived personal data) is confined to one owning component with its own permission strings (FR5.1, NFR3), making the access surface auditable in one place.

## ADR-002: PlanTeam persisted as a structured field on the solution plan item

- **Context** — The saved team must be versioned with the plan, read by document generation, and survive plan regeneration per FR3.1. The codebase already attaches structured, server-validated data to the plan item (`costSchedule`). (Q2)
- **Decision** — PlanTeam is a structured, nullable field on the solution plan item, exactly like the cost schedule. (Q2: A)
- **Consequences** — Positive: one read gives generation the plan and its team; org scoping, versioning, and permissions inherit from the plan item; matches a proven precedent. Negative: a two-way SolutionPlan ↔ TeamDefinition interaction (ADR-005); team history is not kept beyond the plan's own versioning.
- **Alternatives Rejected** — Separate opportunity-keyed team entity: independent lifecycle nobody asked for, an extra read in every consumer, and a second org-scoping surface to secure.
- **Security/compliance** — Team data inherits the plan item's org scoping and existing solution-plan permissions (FR5.2); no new access surface for plan-embedded personnel references.

## ADR-003: Full-pool matching without a vector index

- **Context** — The past-performance engine indexes entities in Pinecone and scores hits deterministically; mirroring it for people would add a new index type and index-maintenance on every employee write. The pool is small (tens to low hundreds — requirements assumption). (Q3)
- **Decision** — No vector index for employees: matching loads the org's full pool and scores deterministically plus with AI against staffing positions and solicitation requirements. (Q3: A)
- **Consequences** — Positive: no new index type, no index-write path in CRUD/import, simpler failure modes; the whole pool is always considered (no recall misses). Negative: does not scale to thousands of employees — revisit if pool size assumptions break.
- **Alternatives Rejected** — Pinecone-mirrored engine: right pattern for large corpora (past projects), unnecessary machinery at this pool size.
- **Security/compliance** — Personal data stays in DynamoDB under org scoping; nothing employee-derived is written to the shared vector store.

## ADR-004: Import deployed by extending the existing extraction worker; logic owned by EmployeePool

- **Context** — An SQS extraction worker already dispatches on target type with job tracking; this feature's import is direct-write (no draft step, affirmed rule). (Q4)
- **Decision** — Reuse the extraction worker deployment with a new EMPLOYEE target type whose handler is EmployeePool's import logic writing employees directly; job tracking and queue wiring are reused. (Q4: A)
- **Consequences** — Positive: no new queue/worker infrastructure; import runs get job tracking for free; progress/failure reporting rides existing machinery. Negative: the EMPLOYEE branch behaves differently from draft-producing branches (direct write) — the divergence must be explicit in the worker's dispatch.
- **Alternatives Rejected** — Dedicated employee-import worker: cleaner separation but duplicates queue, job tracking, and document handling for one target type.
- **Security/compliance** — The worker path writes through EmployeePool's own persistence rules, so org scoping and validation are not bypassed by the async path.

## ADR-005: Deliberate SolutionPlan ↔ TeamDefinition interaction cycle

- **Context** — FR3.1 requires the team to be proposed during plan synthesis, and Q2: A embeds the saved team in the plan item. Proposing flows plan→team; persisting flows team→plan.
- **Decision** — Accept the two-way interaction: SolutionPlan invokes TeamDefinition's matching during synthesis (receiving the proposed team as a return value and writing its own item); TeamDefinition persists team saves/regenerates onto the plan item via SolutionPlan's persistence path.
- **Consequences** — Positive: each component keeps its own responsibility (synthesis vs. matching/lifecycle) without a third mediator. Negative: the two components must version their interface together; flagged for extra scrutiny in functional design.
- **Alternatives Rejected** — Folding team logic into SolutionPlan (bloats an already large domain with matching logic); an event-mediated one-way flow (adds async complexity for an in-process pipeline step with no consumer besides the plan).
- **Security/compliance** — No change to trust boundaries; both directions run inside the backend with the plan item's existing org scoping.
