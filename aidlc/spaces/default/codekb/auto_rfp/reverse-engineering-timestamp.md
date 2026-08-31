# Reverse Engineering Timestamp

## Run Record

- **Date**: 2026-08-27
- **Git commit**: `4b1d13803b7bc8e478a53766135b034425e2280e` (branch `feature/solution-plan-versioning`)
- **Repository**: auto_rfp (pnpm workspaces monorepo)
- **Intent**: 260821-solution-plan-versioning
- **Pipeline**: developer-agent focused code scan (link 1) → architect-agent synthesis (link 2, this run)
- **Replaces**: prior store built by intent 260818-team-definition (verdict STALE)

## Coverage Summary

This was a FOCUSED scan of the solution-plan versioning blast radius: the SolutionPlan entity and its five write hook points (synthesis, manual edit, re-init, team writes, staleness), the S3 HTML version layout, the grilling SQS worker, document-generation read points, and the existing version-history precedent (RFPDocumentVersion / QuestionnaireVersion / RequiredFormVersion). Everything outside that radius — answer generation, KB pipelines, SAM.gov, pricing/staffing beyond `costSchedule`, auth stack internals, e2e suites — was NOT analyzed in this run. Do not rely on this store for those areas without widening the scan.

## Scope of Analysis

```yaml
scope_version: 1
kind: partial
intent: 260821-solution-plan-versioning
fingerprint: 5f5b651090792adbfd52a5e45e55433a306068db
analyzed:
  paths:
    - packages/core/src/schemas/solution-plan.ts
    - packages/core/src/schemas/rfp-document-version.ts
    - packages/core/src/constants.ts
    - apps/functions/src/constants/solution-plan.ts
    - apps/functions/src/helpers/solution-plan.ts
    - apps/functions/src/helpers/solution-plan-init.ts
    - apps/functions/src/helpers/solution-plan-worker.ts
    - apps/functions/src/helpers/plan-team.ts
    - apps/functions/src/helpers/rfp-document-version.ts
    - apps/functions/src/helpers/db.ts
    - apps/functions/src/handlers/solution-plan/
    - apps/functions/src/helpers/generate-document-worker.ts
    - apps/functions/src/helpers/team-qualifications-context.ts
    - apps/functions/src/helpers/solution-plan-gate.ts
    - packages/infra/api/routes/solution-plan.routes.ts
    - packages/infra/api/api-orchestrator-stack.ts
    - apps/web/features/solution-plan/hooks/useSolutionPlan.ts
    - apps/web/features/solution-plan/hooks/useUpdateSolutionPlan.ts
    - apps/web/features/solution-plan/lib/swr.ts
    - apps/web/features/solution-plan/components/SolutionPlanEditorPage.tsx
  components:
    - SolutionPlan Core
    - PlanTeam
    - SolutionPlan Worker
    - Document Generation Plan Readers
    - Team Qualifications Context
    - SolutionPlan Gate
    - Version-History Precedents
    - Web Solution-Plan Feature
shallow:
  paths:
    - apps/functions/src/helpers/document-prompts.ts
    - apps/functions/src/helpers/document-tools.ts
    - apps/functions/src/helpers/document-context.ts
    - apps/functions/src/helpers/document-generation.ts
    - apps/functions/src/handlers/rfp-document/
    - apps/functions/src/helpers/bedrock-http-client.ts
    - apps/functions/src/helpers/executive-opportunity-brief.ts
    - apps/functions/src/helpers/executive-brief-queue.ts
    - apps/functions/src/handlers/question-file/create-question-file.ts
    - apps/functions/src/handlers/brief/init-executive-brief.ts
    - apps/web/features/solution-plan/
```
