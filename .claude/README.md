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
│   └── test-generator.md        # Comprehensive test suite generation
├── skills/                      # Reusable skills (10 skills)
│   ├── audit-logging/SKILL.md   # Audit trail logging for handlers & services
│   ├── backend-test/SKILL.md    # Jest tests with AWS SDK & middy mocking
│   ├── cdk-route/SKILL.md       # API Gateway routes with Lambda integration
│   ├── dynamodb-helper/SKILL.md # DynamoDB helpers with SK builders & CRUD
│   ├── e2e-test/SKILL.md        # Playwright E2E tests with auth fixtures
│   ├── frontend-feature/SKILL.md # Feature modules (hooks, components, pages)
│   ├── frontend-form/SKILL.md   # Forms with react-hook-form & Zod validation
│   ├── lambda/SKILL.md          # Lambda handlers with middy & Sentry
│   ├── step-function/SKILL.md   # Step Functions pipelines with CDK
│   └── zod-schema/SKILL.md      # Zod schemas with types & DTOs
└── rules/                       # Project rules (tracked in git)
    ├── 01-project-structure.md
    ├── 02-typescript-best-practices.md
    ├── 03-entity-definitions.md
    ├── 04-backend-architecture.md
    ├── 05-dynamodb-design.md
    ├── 06-frontend-architecture.md
    ├── 07-infrastructure.md
    ├── 08-cicd.md
    ├── 09-testing.md
    ├── RULES.md
    ├── README.md
    ├── cost-optimization.md
    ├── next-js.md
    ├── web-development.md
    └── workflows/
        ├── architecture.md
        └── implementation.md
```

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

---

## Rules Directory

The `rules/` directory contains markdown files that Claude Code automatically reads when working on this project. These rules define:

- **Project conventions** and coding standards
- **Architecture patterns** for backend and frontend
- **Database design** patterns
- **Testing requirements**
- **CI/CD workflows**

These files are synced from `.clinerules/` to ensure consistency across different AI coding assistants.

## Settings

- `settings.json` - Team-wide Claude Code settings (tracked in git)
- `settings.local.json` - Personal Claude Code settings (gitignored)

## Syncing Rules

To update Claude Code rules from clinerules:

```bash
cp -r .clinerules/* .claude/rules/
```

## Learn More

- [Claude Code Documentation](https://docs.claude.ai/code)
- [Project Rules in .clinerules/](../.clinerules/README.md)
