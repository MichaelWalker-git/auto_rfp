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
import { putRFPDocument, updateRFPDocumentMetadata } from '@/helpers/rfp-document';
import { enqueueDocumentGeneration } from '@/helpers/document-generation-queue';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { ORG_PK } from '@/constants/organization';
import { getItem } from '@/helpers/db';
import { getUserByOrgAndId } from '@/helpers/user';
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

    const { projectId, opportunityId, documentType, templateId, documentId: existingDocumentId } = data;

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

    // 3. Fetch org + user contact info for document generation (best-effort, non-blocking)
    let orgContact: import('@/helpers/document-generation-queue').OrgContactInfo | undefined;
    let userContact: import('@/helpers/document-generation-queue').UserContactInfo | undefined;

    try {
      const [orgItem, userItem] = await Promise.all([
        getItem<Record<string, unknown>>(ORG_PK, `ORG#${orgId}`),
        userId ? getUserByOrgAndId(orgId, userId) : Promise.resolve(null),
      ]);

      if (orgItem) {
        orgContact = {
          orgName: (orgItem.name as string | undefined) ?? undefined,
          orgAddress: (orgItem.address as string | undefined) ?? undefined,
          orgPhone: (orgItem.phone as string | undefined) ?? undefined,
          orgEmail: (orgItem.email as string | undefined) ?? undefined,
          orgWebsite: (orgItem.website as string | undefined) ?? undefined,
        };
      }

      if (userItem) {
        const displayName = userItem.displayName
          ?? (userItem.firstName && userItem.lastName
            ? `${userItem.firstName} ${userItem.lastName}`
            : userItem.firstName ?? undefined);
        userContact = {
          name: displayName,
          email: userItem.email,
          title: (userItem as unknown as Record<string, unknown>).title as string | undefined,
          phone: (userItem as unknown as Record<string, unknown>).phone as string | undefined,
        };
      }
    } catch (contactErr) {
      console.warn('Could not fetch org/user contact info for document generation:', (contactErr as Error)?.message);
    }

    // 4. Enqueue the generation job to SQS
    await enqueueDocumentGeneration({
      orgId,
      projectId,
      opportunityId: effectiveOpportunityId,
      documentType,
      templateId,
      documentId,
      orgContact,
      userContact,
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
