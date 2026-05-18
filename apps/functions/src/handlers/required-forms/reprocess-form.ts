import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';
import { extractFormFieldsWithVision } from '@/helpers/extract-form-fields-vision';
import { matchFieldsToProfile } from '@/helpers/form-field-matcher';
import { getCompanyProfile } from '@/helpers/company-profile';
import { gatherAllContext } from '@/helpers/document-context';

import type { DetectedFormField, FormFieldStatus } from '@auto-rfp/core';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const QuerySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  formId: z.string().min(1),
});

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { success, data, error } = QuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const form = await getRequiredForm({ orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  // Set status to ANALYZING
  await updateRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
    patch: { status: 'IN_PROGRESS' },
  });

  try {
    // Re-extract fields from the source file using vision
    let fields: DetectedFormField[] = [];
    const isPdf = form.sourceFileKey.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      fields = await extractFormFieldsWithVision(form.sourceFileKey);
    }

    // Load document text for context (form instructions)
    let documentText = '';
    try {
      const { loadTextFromS3 } = await import('@/helpers/s3');
      const { requireEnv } = await import('@/helpers/env');
      const textKey = form.sourceFileKey.replace(/\.(pdf|xlsx|xls|docx)$/i, '.txt');
      documentText = await loadTextFromS3(requireEnv('DOCUMENTS_BUCKET'), textKey).catch(() => '');
    } catch { /* non-fatal */ }

    // Re-fill from company profile + document context
    const profile = await getCompanyProfile(orgId);

    if (profile && fields.length > 0) {
      const matchResults = await matchFieldsToProfile(fields, profile, documentText);
      fields = fields.map((f) => {
        const match = matchResults.find((m) => m.fieldId === f.fieldId);
        if (!match) return f;
        if (match.manualReason) {
          return { ...f, status: 'MANUAL_REQUIRED' as FormFieldStatus, manualReason: match.manualReason };
        }
        if (match.profileFieldKey && match.value && match.confidence >= 0.85) {
          return { ...f, value: match.value, status: 'AUTO_FILLED' as FormFieldStatus, confidence: match.confidence, profileFieldKey: match.profileFieldKey };
        }
        if (match.profileFieldKey && match.value && match.confidence > 0.5) {
          return { ...f, value: match.value, status: 'LOW_CONFIDENCE' as FormFieldStatus, confidence: match.confidence, profileFieldKey: match.profileFieldKey };
        }
        return f;
      });
    }

    const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;
    const manual = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
    const total = fields.length;

    await updateRequiredForm({
      orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
      patch: {
        fields,
        status: 'READY',
        autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
        manualFieldCount: manual,
        totalFieldCount: total,
      },
    });

    return apiResponse(200, { ok: true, totalFields: total, autoFilled, manual });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRequiredForm({
      orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
      patch: { status: 'FAILED', errorMessage: message },
    });
    return apiResponse(500, { message: `Reprocessing failed: ${message}` });
  }
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
