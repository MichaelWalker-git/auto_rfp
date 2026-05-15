import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { FormFieldStatusSchema } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { getRFPDocument, updateRFPDocumentMetadata } from '@/helpers/rfp-document';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const BoundingBoxSchema = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});

const BodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
  fieldId: z.string().min(1),
  value: z.string().nullable().optional(),
  label: z.string().optional(),
  status: FormFieldStatusSchema.optional(),
  boundingBox: BoundingBoxSchema.optional(),
  delete: z.boolean().optional(),
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
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  let formFields = (doc.formFields as Array<Record<string, unknown>>) ?? [];
  const fieldIdx = formFields.findIndex((f) => f.fieldId === data.fieldId);

  if (data.delete) {
    if (fieldIdx === -1) return apiResponse(404, { message: 'Field not found' });
    formFields = formFields.filter((f) => f.fieldId !== data.fieldId);
  } else if (fieldIdx === -1) {
    // Create new field
    formFields.push({
      fieldId: data.fieldId,
      label: data.label ?? 'New Field',
      value: data.value ?? null,
      status: data.value ? 'AUTO_FILLED' : 'EMPTY',
      confidence: null,
      profileFieldKey: null,
      manualReason: null,
      pageNumber: 1,
      cellReference: null,
      boundingBox: data.boundingBox ?? null,
    });
  } else {
    const updates: Record<string, unknown> = {};
    if (data.value !== undefined) updates.value = data.value;
    if (data.label !== undefined) updates.label = data.label;
    if (data.boundingBox !== undefined) updates.boundingBox = data.boundingBox;
    if (data.status !== undefined) updates.status = data.status;
    else if (data.value !== undefined) updates.status = data.value ? 'AUTO_FILLED' : 'EMPTY';
    formFields[fieldIdx] = { ...formFields[fieldIdx], ...updates };
  }

  await updateRFPDocumentMetadata({
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    updates: { formFields } as Record<string, unknown>,
    updatedBy: userId,
  });

  return apiResponse(200, { ok: true, field: formFields[fieldIdx] });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
