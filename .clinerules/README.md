# Project Rules & Conventions

> This directory contains the single source of truth for project conventions.
> Update these files every time a new rule or pattern is established.

---

## 📚 Documentation Structure

1. **[01-project-structure.md](01-project-structure.md)** — Monorepo organization and directory conventions
2. **[02-typescript-best-practices.md](02-typescript-best-practices.md)** — TypeScript guidelines and type safety rules
3. **[03-entity-definitions.md](03-entity-definitions.md)** — Domain entity and Zod schema conventions
4. **[04-backend-architecture.md](04-backend-architecture.md)** — Lambda handlers, services, and business logic
5. **[05-dynamodb-design.md](05-dynamodb-design.md)** — Single-table design patterns and access patterns
6. **[06-frontend-architecture.md](06-frontend-architecture.md)** — Next.js App Router and component patterns
7. **[07-infrastructure.md](07-infrastructure.md)** — AWS CDK infrastructure definitions
8. **[08-cicd.md](08-cicd.md)** — CI/CD workflows and deployment strategies
9. **[09-testing.md](09-testing.md)** — Testing rules and conventions
10. **[10-audit-trail.md](10-audit-trail.md)** — Audit trail requirements for every new feature

---

## 🔄 Workflows

Workflows are step-by-step guides for Cline/Claude to follow when performing specific tasks:

| Workflow | Trigger | Description |
|---|---|---|
| **[Architecture](workflows/architecture.md)** | "Design [feature]" | Produce implementation-ready architecture docs for new features |
| **[Implementation](workflows/implementation.md)** | "Implement [feature]" | Build a feature from an existing architecture doc |
| **[Code Review](workflows/code-review.md)** | "Review [feature/file/dir]" | AI-powered code audit with structured findings report |
| **[Fix Review](workflows/fix-review.md)** | "Fix [review report]" | Systematically resolve issues found by code review |

### Code Review Quick Start

Ask Cline/Claude to review code using any of these patterns:
- `"Review the answer feature"` — Full feature review (schemas, handlers, tests, frontend)
- `"Review apps/functions/src/handlers/clustering/"` — Directory review
- `"Review apps/web/components/brief/helpers.ts"` — Single file review
- `"Security review the auth handlers"` — Security-focused review

Reports are generated at `docs/reviews/<target>-review-YYYY-MM-DD.md`.

---

## 🎯 Quick Reference

### For Backend Development
- Start with [04-backend-architecture.md](04-backend-architecture.md) for Lambda patterns
- Reference [03-entity-definitions.md](03-entity-definitions.md) for schema creation
- Check [05-dynamodb-design.md](05-dynamodb-design.md) for data access patterns

### For Frontend Development
- Start with [06-frontend-architecture.md](06-frontend-architecture.md) for component patterns
- Reference [02-typescript-best-practices.md](02-typescript-best-practices.md) for type safety

### For Infrastructure
- See [07-infrastructure.md](07-infrastructure.md) for CDK stack organization
- Check [08-cicd.md](08-cicd.md) for deployment workflows

---

## 📝 Maintenance

When adding new conventions:
1. Update the appropriate file based on the topic
2. If the topic doesn't fit existing files, create a new numbered file
3. Update this README with the new file reference
4. Keep examples concise and actionable
