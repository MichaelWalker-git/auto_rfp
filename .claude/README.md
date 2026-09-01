# Claude Code Configuration

This directory contains configuration and rules for [Claude Code](https://claude.ai/code).

## Directory Structure

```
.claude/
├── README.md                    # This file
├── settings.json                # Team settings (tracked in git)
├── settings.local.json          # Personal settings (gitignored)
├── agents/                      # Custom agents for specialized workflows
│   ├── feature-implementer.md   # End-to-end feature implementation
│   ├── code-reviewer.md         # Convention compliance & security audit
│   ├── feature-reviewer.md      # End-to-end feature / branch diff review
│   └── test-generator.md        # Comprehensive test suite generation
└── skills/                      # Reusable skills (15 skills)
    ├── audit-logging/SKILL.md   # Audit trail logging for handlers & services
    ├── backend-test/SKILL.md    # Jest tests with AWS SDK & middy mocking
    ├── cdk-route/SKILL.md       # API Gateway routes with Lambda integration
    ├── dynamodb-helper/SKILL.md # DynamoDB helpers with SK builders & CRUD
    ├── e2e-test/SKILL.md        # Playwright E2E tests with auth fixtures
    ├── frontend-feature/SKILL.md # Feature modules (hooks, components, pages)
    ├── frontend-form/SKILL.md   # Forms with react-hook-form & Zod validation
    ├── lambda/SKILL.md          # Lambda handlers with middy & Sentry
    ├── review-conventions/SKILL.md # Convention compliance review
    ├── review-correctness/SKILL.md # Correctness & logic review
    ├── review-performance/SKILL.md # Performance review
    ├── review-security/SKILL.md # Security review
    ├── review-tests/SKILL.md    # Test coverage review
    ├── step-function/SKILL.md   # Step Functions pipelines with CDK
    └── zod-schema/SKILL.md      # Zod schemas with types & DTOs
```

Convention rules live in `/.clinerules/` at the repo root, not here — see
[Rules](#rules) below.

## 🤖 Agents

Agents are specialized personas that can be invoked in Claude Code to handle specific workflows. Use them with `/agent <name>` in Claude Code.

### 1. Feature Implementer (`feature-implementer`)

**When to use**: Building a new feature end-to-end across the monorepo.

Implements features in the correct dependency order:
```
Core Schemas → Constants → Helpers → Lambda Handlers → CDK Routes → CDK Infra → Frontend Hooks → Components → Tests
```

**Example prompts**:
- `"Implement the FOIA request feature from docs/FOIA-IMPLEMENTATION.md"`
- `"Build a new notifications CRUD with REST API and React UI"`
- `"Add a deadline extraction feature with DynamoDB storage and frontend display"`

---

### 2. Code Reviewer (`code-reviewer`)

**When to use**: Auditing code for correctness, security, and convention compliance before merging.

Checks 30+ rules across TypeScript, backend, frontend, DynamoDB, testing, and audit trail categories. Produces a structured report at `docs/reviews/`.

**Example prompts**:
- `"Review the answer feature"`
- `"Review apps/functions/src/handlers/clustering/"`
- `"Security review the auth handlers"`
- `"Review apps/web/components/brief/helpers.ts"`

**Output**: Structured markdown report with severity levels (🔴 Critical, 🟡 Warning, 🔵 Info) and a compliance summary table.

---

### 3. Test Generator (`test-generator`)

**When to use**: Writing comprehensive tests for handlers, helpers, schemas, or components.

Generates tests with proper AWS SDK mocking, covers all code paths (happy path, validation, not-found, guards, errors, edge cases), and follows project conventions.

**Example prompts**:
- `"Write tests for apps/functions/src/handlers/document/download-document.ts"`
- `"Write tests for the brief feature"`
- `"Write schema tests for packages/core/src/schemas/project.ts"`
- `"Write tests for apps/web/components/brief/"`

---

## 🛠️ Skills

Skills are reusable instruction sets that Claude Code can activate for specific tasks. Each skill provides step-by-step templates and hard rules for a particular type of work.

| # | Skill | Description | Trigger Example |
|---|---|---|---|
| 1 | **`zod-schema`** | Create Zod schemas with types, Create/Update DTOs, barrel exports | `"Create a schema for notifications"` |
| 2 | **`lambda`** | Lambda handler with middy, Zod validation, audit, Sentry | `"Create a handler to list notifications"` |
| 3 | **`cdk-route`** | API Gateway route with Lambda integration in CDK | `"Add API routes for the notification domain"` |
| 4 | **`dynamodb-helper`** | DynamoDB helpers with SK builders and CRUD operations | `"Create DynamoDB helpers for notifications"` |
| 5 | **`frontend-feature`** | Feature module with hooks, components, pages (FSD) | `"Create the notifications frontend feature"` |
| 6 | **`frontend-form`** | Form page with react-hook-form, Zod, Shadcn UI | `"Create a notification create/edit form"` |
| 7 | **`backend-test`** | Jest tests with AWS SDK mocking, middy mocking | `"Write tests for the create-notification handler"` |
| 8 | **`e2e-test`** | Playwright E2E tests with auth fixtures, page objects | `"Write E2E tests for the notifications feature"` |
| 9 | **`audit-logging`** | Audit trail logging with proper actions and patterns | `"Add audit logging to the notification handlers"` |
| 10 | **`step-function`** | Step Functions pipelines with CDK for async workflows | `"Create a notification delivery pipeline"` |
| 11 | **`review-correctness`** | Correctness and logic audit of a change | `"Review the brief helpers for correctness"` |
| 12 | **`review-conventions`** | Convention compliance audit against project rules | `"Check the new handlers against our conventions"` |
| 13 | **`review-security`** | Security audit (auth, RBAC, `orgId` handling, input validation) | `"Security review the FOIA handlers"` |
| 14 | **`review-performance`** | Performance audit (queries, re-renders, bundle cost) | `"Review the search page for performance"` |
| 15 | **`review-tests`** | Test coverage and test quality audit | `"Are the answer-generation tests adequate?"` |

---

## Rules

Convention rules live in `/.clinerules/` at the repo root — the single source of
truth, shared across AI coding assistants. They cover:

- **Project conventions** and coding standards
- **Architecture patterns** for backend and frontend
- **Database design** patterns
- **Testing requirements**
- **CI/CD workflows**

They are **reference material, read on demand** — not ambient context. There is
deliberately no `.claude/rules/` copy: Claude Code auto-loads every `.md` under
that path into every turn, which cost ~20k tokens (10% of the window) before it
was removed. The critical subset is summarised in `/CLAUDE.md`; point Claude at a
specific `.clinerules/` file when you need the full detail.

## Settings

- `settings.json` - Team-wide Claude Code settings (tracked in git)
- `settings.local.json` - Personal Claude Code settings (gitignored)

## Learn More

- [Claude Code Documentation](https://docs.claude.ai/code)
- [Project Rules in .clinerules/](../.clinerules/README.md)
