import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getProjectById } from '@/helpers/project';
// Note: org/user contact info is now fetched directly by the get_organization_context
// AI tool during generation — no need to pass it through the SQS message.
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { putRFPDocument, updateRFPDocumentMetadata } from '@/helpers/rfp-document';
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
  /** If provided, regenerate content into this existing document instead of creating a new one */
  documentId: z.string().optional(),
  /** Optional export options for CLARIFYING_QUESTIONS document type */
  options: z.record(z.unknown()).optional(),
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

    const { projectId, opportunityId, documentType, templateId, documentId: existingDocumentId, options } = data;

    // 2. Load project & extract orgId
    const project = await getProjectById(projectId);
    if (!project) return apiResponse(404, { message: 'Project not found' });

    const orgId = getOrgId(event) || extractOrgId((project as DBProjectItem).sort_key);
    if (!orgId) return apiResponse(400, { message: 'Cannot extract orgId from project' });

    const userId = getUserId(event);
    const effectiveOpportunityId = opportunityId || 'default';

    let documentId: string;

    if (existingDocumentId) {
      // ── Regenerate: reuse existing document, reset status to GENERATING ──
      documentId = existingDocumentId;
      await updateRFPDocumentMetadata({
        projectId,
        opportunityId: effectiveOpportunityId,
        documentId,
        updates: { status: 'GENERATING', content: null, htmlContentKey: undefined },
        updatedBy: userId ?? 'system',
      });
    } else {
      // ── New document: create a placeholder with status GENERATING ──
      documentId = uuidv4();
      const now = nowIso();
      const sk = `${projectId}#${effectiveOpportunityId}#${documentId}`;
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
    }

    // 3. Enqueue the generation job to SQS
    // Org/user contact info is fetched directly by the get_organization_context AI tool
    // during generation — no need to pass it through the SQS message.
    await enqueueDocumentGeneration({
      orgId,
      projectId,
      opportunityId: effectiveOpportunityId,
      documentType,
      templateId,
      documentId,
      options,
    });

    // 4. Return 202 Accepted
    
    setAuditContext(event, {
      action: 'AI_GENERATION_STARTED',
      resource: 'document',
      resourceId: documentId,
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
    return apiResponse(500, { message: 'Internal server error during document generation' });
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
