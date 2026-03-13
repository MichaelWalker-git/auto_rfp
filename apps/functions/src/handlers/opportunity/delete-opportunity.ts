import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

import { deleteOpportunity } from '@/helpers/opportunity';
import { listQuestionFilesByOpportunity, deleteQuestionFile } from '@/helpers/questionFile';
import { requireEnv } from '@/helpers/env';
import { queryBySkPrefix, deleteItem, batchDeleteItems } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EXEC_BRIEF_PK } from '@/constants/exec-brief';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { APN_REGISTRATION_PK } from '@/constants/apn';
import { DEADLINE_PK } from '@/constants/deadline';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { RFP_DOCUMENT_VERSION_PK } from '@/constants/rfp-document-version';
import { PROPOSAL_SUBMISSION_PK } from '@/constants/proposal-submission';
import { CLARIFYING_QUESTION_PK } from '@/constants/clarifying-question';
import { ENGAGEMENT_LOG_PK } from '@/constants/engagement-log';
import { QUESTION_CLUSTER_PK } from '@/constants/clustering';
import { DOCUMENT_APPROVAL_PK } from '@/constants/document-approval';
import {
  OPPORTUNITY_CONTEXT_PK,
  createOpportunityContextSK,
} from '@auto-rfp/core';
import {
  PROJECT_OUTCOME_PK,
  DEBRIEFING_PK,
  FOIA_REQUEST_PK,
} from '@/constants/organization';

const S3_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const s3Client = new S3Client({});

// ─── Helper: delete all items matching a PK + SK prefix ───────────────────────

interface DeleteResult {
  entity: string;
  count: number;
}

const deleteByPrefix = async (
  pk: string,
  skPrefix: string,
  entityName: string,
): Promise<DeleteResult> => {
  try {
    const items = await queryBySkPrefix<Record<string, unknown>>(pk, skPrefix);
    if (items.length === 0) return { entity: entityName, count: 0 };

    const keys = items.map(item => ({
      pk,
      sk: item[SK_NAME] as string,
    }));

    await batchDeleteItems(keys);
    return { entity: entityName, count: items.length };
  } catch (err) {
    console.warn(`[delete-opportunity] Failed to delete ${entityName} (continuing):`, (err as Error)?.message);
    return { entity: entityName, count: 0 };
  }
};

/**
 * Delete opportunity and cascade delete ALL related entities:
 * - Question files + S3 objects
 * - Executive briefs
 * - Questions (extracted)
 * - Answers (generated)
 * - APN registrations
 * - Deadlines
 * - RFP documents + versions
 * - Project outcomes
 * - Debriefings
 * - FOIA requests
 * - Clarifying questions
 * - Engagement logs
 * - Question clusters
 * - Proposal submissions
 * - Document approvals
 * - Opportunity context
 */
const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId, oppId, orgId } = event.queryStringParameters ?? {};

    if (!orgId || !projectId || !oppId) {
      return apiResponse(400, {
        ok: false,
        error: 'Missing required parameters: projectId, oppId, orgId',
      });
    }

    console.log(`[delete-opportunity] Starting cascade delete for orgId=${orgId}, projectId=${projectId}, oppId=${oppId}`);

    const deletionResults: DeleteResult[] = [];

    // ── Step 1: Delete question files + S3 objects ────────────────────────────
    const { items: questionFiles } = await listQuestionFilesByOpportunity({ projectId, oppId });

    if (questionFiles.length > 0) {
      // Delete S3 objects
      const objectsToDelete = questionFiles
        .flatMap(qf => [qf.fileKey, qf.textFileKey].filter(Boolean))
        .map(key => ({ Key: key! }));

      if (objectsToDelete.length > 0) {
        // S3 DeleteObjects supports max 1000 keys per request
        for (let i = 0; i < objectsToDelete.length; i += 1000) {
          const batch = objectsToDelete.slice(i, i + 1000);
          await s3Client.send(new DeleteObjectsCommand({
            Bucket: S3_BUCKET,
            Delete: { Objects: batch },
          }));
        }
      }

      // Delete question file records
      for (const qf of questionFiles) {
        if (qf.questionFileId) {
          await deleteQuestionFile({ projectId, oppId, questionFileId: qf.questionFileId });
        }
      }
      deletionResults.push({ entity: 'questionFiles', count: questionFiles.length });
      deletionResults.push({ entity: 's3Objects', count: objectsToDelete.length });
    }

    // ── Step 2: Delete all related entities by SK prefix ──────────────────────
    // Most entities use SK format: {orgId}#{projectId}#{oppId}#...
    // Some use: {projectId}#{oppId}#...
    const orgProjectOppPrefix = `${orgId}#${projectId}#${oppId}`;
    const projectOppPrefix = `${projectId}#${oppId}`;

    // Entities with orgId#projectId#oppId SK prefix
    const orgScopedEntities: Array<[string, string]> = [
      [ANSWER_PK, 'answers'],
      [APN_REGISTRATION_PK, 'apnRegistrations'],
      [RFP_DOCUMENT_PK, 'rfpDocuments'],
      [RFP_DOCUMENT_VERSION_PK, 'rfpDocumentVersions'],
      [PROJECT_OUTCOME_PK, 'projectOutcomes'],
      [DEBRIEFING_PK, 'debriefings'],
      [FOIA_REQUEST_PK, 'foiaRequests'],
      [CLARIFYING_QUESTION_PK, 'clarifyingQuestions'],
      [ENGAGEMENT_LOG_PK, 'engagementLogs'],
      [PROPOSAL_SUBMISSION_PK, 'proposalSubmissions'],
      [DOCUMENT_APPROVAL_PK, 'documentApprovals'],
    ];

    // Entities with projectId#oppId SK prefix (no orgId)
    const projectScopedEntities: Array<[string, string]> = [
      [QUESTION_PK, 'questions'],
      [QUESTION_CLUSTER_PK, 'questionClusters'],
    ];

    // Execute all deletions in parallel for speed
    const deletePromises = [
      ...orgScopedEntities.map(([pk, name]) => deleteByPrefix(pk, orgProjectOppPrefix, name)),
      ...projectScopedEntities.map(([pk, name]) => deleteByPrefix(pk, projectOppPrefix, name)),
    ];

    const results = await Promise.all(deletePromises);
    deletionResults.push(...results);

    // ── Step 3: Delete executive briefs ───────────────────────────────────────
    // Executive briefs use SK: {projectId}#{opportunityId}
    const briefResult = await deleteByPrefix(EXEC_BRIEF_PK, `${projectId}#${oppId}`, 'executiveBriefs');
    deletionResults.push(briefResult);

    // ── Step 4: Delete deadlines ──────────────────────────────────────────────
    // Deadlines use SK: {orgId}#{projectId}#{oppId}
    const deadlineResult = await deleteByPrefix(DEADLINE_PK, orgProjectOppPrefix, 'deadlines');
    deletionResults.push(deadlineResult);

    // ── Step 5: Delete opportunity context ────────────────────────────────────
    try {
      const contextSk = createOpportunityContextSK(orgId, projectId, oppId);
      await deleteItem(OPPORTUNITY_CONTEXT_PK, contextSk);
      deletionResults.push({ entity: 'opportunityContext', count: 1 });
    } catch {
      // Context may not exist — that's fine
      deletionResults.push({ entity: 'opportunityContext', count: 0 });
    }

    // ── Step 6: Delete the opportunity itself ─────────────────────────────────
    await deleteOpportunity({ orgId, projectId, oppId });
    deletionResults.push({ entity: 'opportunity', count: 1 });

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalDeleted = deletionResults.reduce((sum, r) => sum + r.count, 0);
    const summary = Object.fromEntries(deletionResults.map(r => [r.entity, r.count]));

    console.log(`[delete-opportunity] Cascade delete complete. Total items deleted: ${totalDeleted}`, summary);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'opportunity',
      resourceId: oppId,
      orgId,
      changes: { before: summary },
    });

    return apiResponse(200, {
      ok: true,
      message: `Opportunity ${oppId} and all related entities deleted`,
      deleted: summary,
      totalDeleted,
    });
  } catch (err) {
    console.error('[delete-opportunity] Error:', err);
    return apiResponse(500, {
      ok: false,
      error: (err as Error)?.message ?? 'Internal Server Error',
    });
  }
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:delete')),
);
