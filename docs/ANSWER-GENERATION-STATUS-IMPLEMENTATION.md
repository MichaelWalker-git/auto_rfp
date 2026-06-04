# Answer Generation Status Endpoint — Implementation Plan <!-- ✅ IMPLEMENTED -->

## Goal

Show a per-question spinner in the question list **while the answer-generation
pipeline is actively running for the opportunity** — including cluster-copied
questions that have no `QUESTION_FILE` record.

## Why the current approach fails

The committed spinner (commit `2010c9dc`) keys off each question-file's
`GENERATING_ANSWERS` status. This breaks for opportunity `beaf6c34`:

- All 42 questions reference `questionFileId = 262d6eb7…`, which has **no
  `QUESTION_FILE` record anywhere in the table** (they were created via cluster
  propagation, not the extract→generate pipeline).
- Even where files exist, `GENERATING_ANSWERS` is set on *all* files at once and
  cleared only at the very end — a coarse batch flag, not per-question.

So there is no reliable file-status signal for these questions. The **only**
authoritative "is generation running for this opportunity" signal today is the
**answer-generation Step Function execution**.

## Key existing facts (verified)

| Fact | Location |
|---|---|
| State machine class `AnswerGenerationPipelineStack`, exposes `this.stateMachine` | `packages/infra/answer-generation-step-function.ts:231` |
| Execution name format: `` `${opportunityId}-${Date.now()}` `` | `apps/functions/src/handlers/answer-pipeline/check-and-trigger-answers.ts:294` |
| Env var name `ANSWER_GENERATION_STATE_MACHINE_ARN` | `check-and-trigger-answers.ts:19` |
| **Exact pattern we need already exists**: `ListExecutionsCommand` + `statusFilter: 'RUNNING'` + `e.name?.includes(opportunityId)` | `check-and-trigger-answers.ts:239-263` |
| SFN client: `import { SFNClient, ListExecutionsCommand } from '@aws-sdk/client-sfn'; const sfnClient = new SFNClient({});` | `check-and-trigger-answers.ts:3,21` |
| ARN is available in bin: `answerGenerationStack.stateMachine.stateMachineArn` | `bin/auto-rfp-infrastructure.ts:131` |
| `commonEnv` for all REST lambdas (add ARN here) | `api/api-orchestrator-stack.ts:178-192` |
| IAM `states:*` block on `commonLambdaRole` (add ListExecutions + answerGen ARN) | `api/api-orchestrator-stack.ts:287-302` |
| Orchestrator props interface (add `answerGenerationStateMachineArn`) | `api/api-orchestrator-stack.ts:78-79` |
| Answer routes file (add GET route) | `packages/infra/api/routes/answer.routes.ts` |
| Answer domain already registered | `api-orchestrator-stack.ts:25,593` (no change needed) |
| Frontend poll pattern to mimic (dynamic refreshInterval) | `apps/web/lib/hooks/use-rfp-documents.ts:193-196` |
| Provider already polls files/answers; needs to switch signal | `questions-provider.tsx` (the `generatingFileIds` block from commit 2010c9dc) |

## What needs to be built

### 1. Backend handler — `apps/functions/src/handlers/answer/get-answer-generation-status.ts`

Thin GET handler. `orgId` + `opportunityId` from query string.

```
GET answer/generation-status/{projectId}?orgId=...&opportunityId=...
→ 200 { isGenerating: boolean, executionArn?: string }
```

Logic (copy from `check-and-trigger-answers.ts:239-263`):
- `ListExecutionsCommand({ stateMachineArn: ANSWER_GENERATION_STATE_MACHINE_ARN, statusFilter: 'RUNNING', maxResults: 100 })`
- `isGenerating = executions.executions?.some(e => e.name?.includes(opportunityId)) ?? false`
- Return `apiResponse(200, { isGenerating, executionArn })`.
- Guard: if ARN env unset → return `{ isGenerating: false }` (don't 500).
- Middy stack + `withSentryLambda`; permission `answer:generate` (reuse — no new permission).

**Test**: `get-answer-generation-status.test.ts` — mock `@aws-sdk/client-sfn`,
test (a) running execution for opp → true, (b) running for a different opp →
false, (c) no executions → false, (d) ARN unset → false, (e) SFN throws →
false (best-effort, never 500).

### 2. Core schema — `packages/core/src/schemas/answer.ts`

Add:
```ts
export const AnswerGenerationStatusResponseSchema = z.object({
  isGenerating: z.boolean(),
  executionArn: z.string().optional(),
});
export type AnswerGenerationStatusResponse = z.infer<typeof AnswerGenerationStatusResponseSchema>;
```
Rebuild `packages/core` after.

### 3. Route — `packages/infra/api/routes/answer.routes.ts`

```ts
{ method: 'GET', path: 'generation-status/{id}', entry: lambdaEntry('answer/get-answer-generation-status.ts') },
```
(`{id}` = projectId, matching `get-answers/{id}` convention.)

### 4. Infra wiring — `packages/infra/api/api-orchestrator-stack.ts` + `bin`

- Add `answerGenerationStateMachineArn: string` to orchestrator props (line ~78).
- Add `ANSWER_GENERATION_STATE_MACHINE_ARN: answerGenerationStateMachineArn` to `commonEnv` (line ~192).
- Add `'states:ListExecutions'` action + the answerGen ARN to the IAM block (line ~287-302).
- In `bin/auto-rfp-infrastructure.ts:144`, pass `answerGenerationStateMachineArn: answerGenerationStack.stateMachine.stateMachineArn`.
- `api.addDependency(answerGenerationStack)`.

### 5. Frontend hook — `apps/web/lib/hooks/use-answer.ts` (or use-api.ts)

`useAnswerGenerationStatus(projectId, opportunityId, orgId)`:
- `useSWR` on `answer/generation-status/{projectId}?orgId&opportunityId`.
- Dynamic `refreshInterval`: `data?.isGenerating ? 4000 : 0` (poll only while running; one extra poll after it stops naturally flips it off).
- Returns `{ isGenerating, executionArn }`.

### 6. Provider — `questions-provider.tsx`

Replace the file-status `generatingFileIds` signal (from commit 2010c9dc) with
the execution signal:
- Call `useAnswerGenerationStatus(projectId, opportunityId, orgId)` →
  `isPipelineGenerating`.
- While `isPipelineGenerating`, poll the questions+answers feed (already wired
  to `refreshInterval` when generating).
- `isGenerating` map = interactiveGenerating ∪ { every still-blank question when
  `isPipelineGenerating` }. (No longer needs `questionFileId`, so it covers
  cluster-copied questions.)
- Keep per-question clear-on-answer-text so each spinner stops as its answer lands.

Keep the `question-file-status.ts` helper additions (harmless), or remove the
now-unused `QUESTION_FILE_GENERATING_STATUS` import.

## Verification

- `cd packages/core && pnpm build`
- `cd apps/functions && pnpm tsc --noEmit && pnpm test -- get-answer-generation-status`
- `cd packages/infra && pnpm tsc --noEmit`
- `cd apps/web && npx tsc --noEmit` (baseline 232 pre-existing errors; expect no new)
- Deploy: `pnpm deploy:dev:api` (under `AWS_PROFILE=AdministratorAccess-039885961427`)
- Manual: trigger generation for an opportunity, confirm blank questions spin and clear live.

## Cost note (per cost-optimization rule)

`ListExecutions` is a cheap control-plane call; polling at 4s only while a run is
active (and stopping when idle) keeps it well within free-tier. No new
infrastructure, no fixed monthly cost.
