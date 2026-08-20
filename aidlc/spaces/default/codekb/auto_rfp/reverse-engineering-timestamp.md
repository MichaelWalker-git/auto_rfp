# Reverse Engineering Timestamp — auto_rfp

## Run Metadata

- **Date**: 2026-08-19
- **Git commit**: `32ec91d791fe11fa881a039f3977c167510148db` (branch `feature/team-qualification-improvement`)
- **Repo**: `auto_rfp` (brownfield, TypeScript/JavaScript pnpm monorepo, root `/home/user/WebstormProjects/auto_rfp`)
- **Chain**: two-step Reverse Engineering — developer code scan → architect synthesis (this run)
- **Artifacts produced**: business-overview.md, architecture.md, code-structure.md, api-documentation.md, component-inventory.md, technology-stack.md, dependencies.md, code-quality-assessment.md, reverse-engineering-timestamp.md

## Coverage Notes

This was a **partial, initiative-focused scan** for the team-definition intent: the solution-plan, document-generation, past-performance, pricing/staffing, extraction, and KB/document areas were read deeply; the other ~50 handler domains, ~145 helpers, 17 web features, remaining ~70 core schemas, infra stacks, evals, scripts, and docs were inventoried at directory/name granularity only. Claims about skimmed areas in the artifacts are structural (names, counts, registration patterns), not behavioral.

## Scope of Analysis

```yaml
scope_version: 1
kind: partial
intent: 260818-team-definition
fingerprint: c052a23acce2c3143ca31df808cd452998280d5f
analyzed:
  paths:
    - packages/core/src/schemas/solution-plan.ts
    - packages/core/src/schemas/rfp-document.ts
    - packages/core/src/schemas/pricing.ts
    - packages/core/src/schemas/past-performance.ts
    - packages/core/src/schemas/document.ts
    - packages/core/src/schemas/kb.ts
    - packages/core/src/schemas/organization.ts
    - packages/core/src/schemas/extraction-job.ts
    - packages/core/src/schemas/user.ts
    - packages/core/src/constants.ts
    - apps/functions/src/handlers/rfp-document/
    - apps/functions/src/handlers/extraction/extraction-worker.ts
    - apps/functions/src/helpers/generate-document-worker.ts
    - apps/functions/src/helpers/document-generation.ts
    - apps/functions/src/helpers/document-context.ts
    - apps/functions/src/helpers/document-prompts.ts
    - apps/functions/src/helpers/document-tools.ts
    - apps/functions/src/helpers/past-performance-matching.ts
    - apps/functions/src/helpers/past-performance.ts
    - apps/functions/src/helpers/solution-plan-prompts.ts
    - apps/functions/src/helpers/db.ts
    - apps/functions/src/helpers/bedrock-http-client.ts
    - apps/functions/src/helpers/autofill-fields-with-tools.ts
    - apps/web/features/solution-plan/
    - apps/web/layouts/sidebar-layout/sidebar-layout.tsx
    - packages/infra/api/routes/solution-plan.routes.ts
    - packages/infra/api/api-orchestrator-stack.ts
    - docs/team defenition/task
  components:
    - Solution Plan
    - Document Generation Pipeline
    - Past-Performance Matching Engine
    - Pricing & Staffing (today's "team definition")
    - Extraction Workers
    - Knowledge Base / Org Documents
    - Org Navigation & Team Page
shallow:
  paths:
    - apps/functions/src/handlers/
    - apps/functions/src/helpers/
    - apps/web/app/
    - apps/web/features/
    - apps/web/lib/hooks/
    - apps/web/components/
    - packages/infra/
    - packages/core/src/schemas/
    - evals/
    - scripts/
    - docs/
    - .github/workflows/
```
