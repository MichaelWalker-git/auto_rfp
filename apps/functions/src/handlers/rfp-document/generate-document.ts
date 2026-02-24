import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getProjectById } from '@/helpers/project';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { putRFPDocument } from '@/helpers/rfp-document';
import { enqueueDocumentGeneration } from '@/helpers/document-generation-queue';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import type { DBProjectItem } from '@/types/project';
import { RFP_DOCUMENT_TYPES, RFPDocumentTypeSchema } from '@auto-rfp/core';

// ─── Input Schema ───

const InputSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().optional(),
  documentType: RFPDocumentTypeSchema.default('TECHNICAL_PROPOSAL'),
  templateId: z.string().optional(),
});

// ─── Helpers ───

const extractOrgId = (sortKey: string) => String(sortKey ?? '').split('#')[0] || '';

const buildPlaceholderName = (documentType: string): string =>
  `Generating ${RFP_DOCUMENT_TYPES[documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? documentType}...`;

// ─── Handler ───

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    // 1. Parse & validate input
    const { success, data, error } = InputSchema.safeParse(JSON.parse(event?.body || ''));
    if (!success) {
      return apiResponse(400, { message: 'Validation error', errors: error.format() });
    }

    const { projectId, opportunityId, documentType, templateId } = data;

    // 2. Load project & extract orgId
    const project = await getProjectById(projectId);
    if (!project) return apiResponse(404, { message: 'Project not found' });

    const orgId = getOrgId(event) || extractOrgId((project as DBProjectItem).sort_key);
    if (!orgId) return apiResponse(400, { message: 'Cannot extract orgId from project' });

    const userId = getUserId(event);
    const documentId = uuidv4();
    const now = nowIso();
    const effectiveOpportunityId = opportunityId || 'default';
    const sk = `${projectId}#${effectiveOpportunityId}#${documentId}`;

    // 3. Create a placeholder RFP document in DB with status GENERATING
    await putRFPDocument({
      [PK_NAME]: RFP_DOCUMENT_PK,
      [SK_NAME]: sk,
      documentId,
      projectId,
      opportunityId: effectiveOpportunityId,
      orgId,
      name: buildPlaceholderName(documentType),
      description: null,
      documentType,
      mimeType: 'application/json',
      fileSizeBytes: 0,
      originalFileName: null,
      fileKey: null,
      version: 1,
      previousVersionId: null,
      signatureStatus: 'NOT_REQUIRED',
      signatureDetails: null,
      linearSyncStatus: 'NOT_SYNCED',
      linearCommentId: null,
      lastSyncedAt: null,
      deletedAt: null,
      status: 'GENERATING',
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // 4. Enqueue the generation job to SQS
    await enqueueDocumentGeneration({
      orgId,
      projectId,
      opportunityId: effectiveOpportunityId,
      documentType,
      templateId,
      documentId,
    });

    // 5. Return 202 Accepted
    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'unknown',
    });

    return apiResponse(202, {
      ok: true,
      status: 'GENERATING',
      documentId,
      projectId,
      opportunityId: effectiveOpportunityId,
      documentType,
      message: 'Document generation started. Poll the document status for completion.',
    });
  } catch (err) {
    console.error('Error in generate-document handler:', err);
    return apiResponse(500, {
      message: 'Internal server error during document generation',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
