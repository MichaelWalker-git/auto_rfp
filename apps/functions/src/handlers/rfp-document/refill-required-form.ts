import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { getRFPDocument, loadRFPDocumentHtml, uploadRFPDocumentHtml, updateRFPDocumentMetadata } from '@/helpers/rfp-document';
import { getCompanyProfile } from '@/helpers/company-profile';
import { gatherAllContext } from '@/helpers/document-context';
import { refillFormHtml } from '@/helpers/form-html-generator';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const BodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
});

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = getUserId(event) ?? 'unknown';
  const raw = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = BodySchema.safeParse(raw);

  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc.deletedAt) {
    return apiResponse(404, { message: 'Document not found' });
  }
  if (doc.orgId !== orgId) {
    return apiResponse(403, { message: 'Access denied' });
  }
  if (doc.documentType !== 'REQUIRED_FORM') {
    return apiResponse(400, { message: 'Only REQUIRED_FORM documents can be re-filled' });
  }

  const htmlContentKey = doc.htmlContentKey as string | undefined;
  if (!htmlContentKey) {
    return apiResponse(400, { message: 'Document has no HTML content to re-fill' });
  }

  const existingHtml = await loadRFPDocumentHtml(htmlContentKey);

  const [profile, knowledgeContext] = await Promise.all([
    getCompanyProfile(orgId),
    gatherAllContext({
      projectId: data.projectId,
      orgId,
      opportunityId: data.opportunityId,
      solicitation: '',
    }).catch(() => ''),
  ]);

  const filledHtml = await refillFormHtml(existingHtml, profile, knowledgeContext);

  const newHtmlKey = await uploadRFPDocumentHtml({
    orgId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    html: filledHtml,
  });

  const hasUnfilledFields = filledHtml.includes('color: #9ca3af') || filledHtml.includes('color:#9ca3af');
  const newStatus = hasUnfilledFields ? 'DRAFT' : 'NEEDS_REVIEW';

  await updateRFPDocumentMetadata({
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    updates: { htmlContentKey: newHtmlKey, status: newStatus },
    updatedBy: userId,
  });

  return apiResponse(200, { ok: true, status: newStatus });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
