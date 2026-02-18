import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { getProjectById } from '@/helpers/project';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { putRFPDocument } from '@/helpers/rfp-document';
import { enqueueDocumentGeneration } from '@/helpers/document-generation-queue';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import type { DBProjectItem } from '@/types/project';

// ─── Input ───

const InputSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().optional(),
  documentType: z.string().min(1).default('TECHNICAL_PROPOSAL'),
  templateId: z.string().optional(),
});

// ─── Helpers ───

const extractOrgId = (sortKey: string) => String(sortKey ?? '').split('#')[0] || '';

// ─── Handler ───

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    // 1. Parse & validate input
    const input = InputSchema.safeParse(JSON.parse(event?.body || ''));
    if (!input.success) {
      return apiResponse(400, { message: 'Validation error', errors: input.error.format() });
    }
    const { projectId, opportunityId, documentType, templateId } = input.data;

    // 2. Load project & extract orgId
    const project = await getProjectById(projectId);
    if (!project) return apiResponse(404, { message: 'Project not found' });

    const orgId = getOrgId(event) || extractOrgId((project as DBProjectItem).sort_key);
    if (!orgId) return apiResponse(400, { message: 'Cannot extract orgId from project' });

    const userId = getUserId(event);

    // 3. Create a placeholder RFP document in DB with status GENERATING
    const documentId = uuidv4();
    const now = new Date().toISOString();
    const effectiveOpportunityId = opportunityId || 'default';
    const sk = `${projectId}#${effectiveOpportunityId}#${documentId}`;

    const item: Record<string, any> = {
      [PK_NAME]: RFP_DOCUMENT_PK,
      [SK_NAME]: sk,
      documentId,
      projectId,
      opportunityId: effectiveOpportunityId,
      orgId,
      name: `Generating ${documentType}...`,
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
      createdBy: userId || null,
      updatedBy: userId || null,
      createdAt: now,
      updatedAt: now,
    };

    await putRFPDocument(item);

    // 4. Enqueue the generation job to SQS
    await enqueueDocumentGeneration({
      orgId,
      projectId,
      opportunityId: effectiveOpportunityId,
      documentType,
      templateId,
      documentId,
    });

    // 5. Return 202 Accepted with the document record
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
    .use(httpErrorMiddleware()),
);