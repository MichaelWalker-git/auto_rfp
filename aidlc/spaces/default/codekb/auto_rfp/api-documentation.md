# API Documentation — Solution-Plan Surface & Versioning Precedent

> Grounded in `packages/infra/api/routes/solution-plan.routes.ts` and the solution-plan wiring in `api-orchestrator-stack.ts` (route registration at lines 752/1024; SQS queue/DLQ/worker at lines 212–819). Endpoints outside this domain were not catalogued in this run, except the rfp-document version precedent.

## Solution-Plan REST API (8 endpoints)

All routes Cognito-authed via the middy stack; `orgId` comes from body/query/path, never the token. All responses via `apiResponse()`.

| Method | Path | Handler | Permission | Notes |
|---|---|---|---|---|
| POST | `/solution-plan/init` | `init-solution-plan.ts` | `proposal:create` | Starts/restarts a grilling run; `auditMiddleware` (AI_GENERATION_STARTED); FULL putItem overwrite of the plan item (fresh `runId`, preserves only `id`, `version`, `createdAt`, `createdBy`; drops `contentKey`, `planTeam`, `costSchedule`); enqueues first `GrillingRoundMessage` |
| GET | `/solution-plan/get` | `get-solution-plan.ts` | `proposal:read` | Full plan metadata: `status`, `version`, `isStale`/`staleReason`, `isUserEdited`, `contentKey`, `planTeam`, `costSchedule`, audit fields |
| GET | `/solution-plan/transcript` | `get-transcript.ts` | `proposal:read` | Grilling transcript (`GRILLING_MESSAGE` items via `queryAllBySkPrefix`) |
| PATCH | `/solution-plan/update` | `update-solution-plan.ts` | `proposal:create` | Manual HTML edit — **write hook**. Optimistic concurrency: conditional write `status=READY AND version=patch.version-1`; bumps version, new S3 key, sets `isUserEdited`/`editedBy`, clears staleness, nulls `costSchedule` |
| GET | `/solution-plan/html-content` | `get-html-content.ts` | `proposal:read` | Serves S3 HTML for the current `contentKey` |
| GET | `/solution-plan/team` | `get-plan-team.ts` | `proposal:read` | Derived-on-read team view |
| PATCH | `/solution-plan/team/save` | `save-plan-team.ts` | `proposal:create` | User team edit — **write hook**; bumps plan version, no new S3 object, no user id recorded |
| POST | `/solution-plan/team/regenerate` | `regenerate-plan-team.ts` | `proposal:create` | Synchronous Bedrock matching — **write hook**; bumps plan version, no new S3 object, no user id recorded |

## Async Contract — SQS Grilling/Synthesis Worker

- **Queue**: `auto-rfp-solution-plan-{stage}`, `batchSize 1`, DLQ `maxReceiveCount 1` — a plain SQS-triggered Lambda (`handlers/solution-plan/solution-plan-worker.ts`), **NOT** a Step Function.
- **Message** (`GrillingRoundMessage`): `orgId`, `projectId`, `opportunityId`, `solutionPlanId`, `runId`, `round`, `phase` — **no user identity**.
- **Behavior**: each round calls Bedrock (HTTP client), appends transcript items, re-enqueues the next round; the final phase runs `processSynthesis` (`helpers/solution-plan-worker.ts` lines 337–418): `version=(plan.version??0)+1`, `uploadSolutionPlanHtml(key, version, html)`, `updateSolutionPlanStatus(key,'READY',{contentKey, version, isStale:false, isUserEdited:false, costSchedule})`. Only `updatedAt` is auto-stamped.
- **Failure**: status `FAILED` with `error` on the plan item; DLQ after a single receive.

## Versioning Precedent — RFP-Document Version Endpoints

Defined in `rfp-document.routes.ts` (handlers in `handlers/rfp-document/`), backed by `helpers/rfp-document-version.ts`:

| Method | Path (shape) | Purpose |
|---|---|---|
| GET | versions | List version records for a document (newest-first by 6-pad `versionNumber` SK) |
| GET | compare | Compare two versions (loads both `htmlContentKey` contents) |
| POST | revert | Restore a prior version as a NEW version; records `createdBy` + `createdByName` (`event.auth?.claims?.name || claims?.email` — see `revert-version.ts`) |
| POST | cherry-pick | Selectively apply content from a prior version |

Version record (`RFPDocumentVersionSchema`): `versionId`, `versionNumber`, `htmlContentKey`, `title`, `wordCount`, `changeNote` (≤500 chars), `createdBy`, `createdByName`, `createdAt`. Storage: `RFP_DOCUMENT_VERSION_PK`, SK `{projectId}#{opportunityId}#{documentId}#{versionNumber:6pad}`. Same pattern exists for `QUESTIONNAIRE_VERSION_PK` and `REQUIRED_FORM_VERSION_PK`, with `KEEP_COUNT = 30` retention pruning. Note: the precedent's request schemas use legacy DTO names (`CreateVersionDTOSchema`, `RevertVersionDTOSchema`); new endpoints must use the 5-type `<Entity>CreateRequest` convention.

## Internal Read Contracts (non-HTTP consumers of the plan)

- `helpers/generate-document-worker.ts` — `loadApprovedSolutionPlanContext` (lines 939–973): loads the READY plan's `contentKey` HTML from S3, strips to text, injects as source-of-truth; stamps generated documents with `solutionPlanId` + `solutionPlanVersion` (`rfp-document.ts:348`, stamping at worker lines 1534–1536; `createVersion` call at 1556).
- `helpers/team-qualifications-context.ts` — reads `plan.planTeam.members`, classifying UNFILLED → DELETED → FILLED with a defensive degrade for stale employee references.
- `helpers/solution-plan-gate.ts` — status gate consumed by `rfp-document/generate-document.ts` and `edit-section.ts`.
- `document-context.ts` does **NOT** read the solution plan.
- Staleness triggers (call `markSolutionPlanStale(Safe)`): `helpers/executive-brief-queue.ts`, `handlers/brief/init-executive-brief.ts`, `handlers/question-file/create-question-file.ts` (solicitation upload).
