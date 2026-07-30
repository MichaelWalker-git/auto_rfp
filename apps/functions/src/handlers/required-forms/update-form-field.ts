import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateFormFieldDTOSchema } from '@auto-rfp/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const BodySchema = UpdateFormFieldDTOSchema.extend({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
});

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const raw = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = BodySchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const {
    formId, fieldId, value, label, status, boundingBox,
    markType, markChar, markGeometry,
    projectId, opportunityId,
  } = data;

  const form = await getRequiredForm({ orgId, projectId, opportunityId, formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  let updatedFields = [...form.fields];

  if (data.delete) {
    updatedFields = updatedFields.filter((f) => f.fieldId !== fieldId);
  } else {
    const fieldIdx = updatedFields.findIndex((f) => f.fieldId === fieldId);
    if (fieldIdx === -1) {
      // Create new field
      updatedFields.push({
        fieldId,
        label: label ?? 'New Field',
        value: value ?? null,
        status: value ? 'AUTO_FILLED' : 'EMPTY',
        confidence: null,
        profileFieldKey: null,
        manualReason: null,
        pageNumber: 1,
        cellReference: null,
        sheetName: null,
        sheetIndex: null,
        boundingBox: boundingBox ?? null,
        markType: markType ?? 'TEXT',
        markChar: markChar ?? null,
        markGeometry: markGeometry ?? null,
        matrixCategory: null,
        matrixFeature: null,
        matrixColumn: 'OTHER',
      });
    } else {
      const existing = updatedFields[fieldIdx];
      const updates: Record<string, unknown> = {};
      if (value !== undefined) updates.value = value;
      if (label !== undefined) updates.label = label;
      if (boundingBox !== undefined) updates.boundingBox = boundingBox;
      if (status !== undefined) updates.status = status;
      else if (value !== undefined) {
        // Don't auto-derive status when the field still requires manual review.
        // Otherwise clearing a MANUAL_REQUIRED cell silently drops the
        // "needs review" signal — the user just hasn't typed yet.
        if (existing.status !== 'MANUAL_REQUIRED') {
          updates.status = value ? 'AUTO_FILLED' : 'EMPTY';
        }
      }
      if (markType !== undefined) updates.markType = markType;
      if (markChar !== undefined) updates.markChar = markChar;
      if (markGeometry !== undefined) updates.markGeometry = markGeometry;
      updatedFields[fieldIdx] = { ...existing, ...updates };
    }
  }

  const autoFilled = updatedFields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = updatedFields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  const total = updatedFields.length;

  const updated = await updateRequiredForm({
    orgId, projectId, opportunityId, formId,
    patch: {
      fields: updatedFields,
      autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
      manualFieldCount: manual,
      totalFieldCount: total,
    },
  });

  return apiResponse(200, { form: updated });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
