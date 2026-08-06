import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import mammoth from 'mammoth';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';
import { startFormsAnalysis } from '@/helpers/textract-forms';
import { getFileFromS3 } from '@/helpers/s3';
import { extractAndAutofillDocxForm } from '@/helpers/docx-form-parser';

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

  const form = await getRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
  });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const lowerKey = form.sourceFileKey?.toLowerCase() ?? '';
  const isPdf = lowerKey.endsWith('.pdf');
  // Only .docx: mammoth reads the OOXML zip, not legacy OLE .doc (rejected at
  // intake). Keeping the guard honest avoids a mammoth throw on a stray .doc.
  const isDocx = lowerKey.endsWith('.docx');
  if (!isPdf && !isDocx) {
    return apiResponse(400, { message: 'Reprocessing is only supported for PDF and .docx forms' });
  }

  await updateRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
    patch: { status: 'IN_PROGRESS', errorMessage: null },
  });

  // DOCX forms are processed synchronously (extract text → LLM field extraction →
  // company-profile autofill). PDFs kick off an async Textract job whose SNS
  // callback finishes the work.
  if (isDocx) {
    try {
      const body = await getFileFromS3(requireEnv('DOCUMENTS_BUCKET'), form.sourceFileKey);
      const buf = await streamToBuffer(body);
      const { value: text } = await mammoth.extractRawText({ buffer: buf });

      const { fields, totalFieldCount, manualFieldCount, autoFillPercentage, docxFillStrategy } =
        await extractAndAutofillDocxForm(buf, text ?? '', orgId);

      await updateRequiredForm({
        orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
        patch: { fields, status: 'READY', totalFieldCount, manualFieldCount, autoFillPercentage, docxFillStrategy },
      });
      return apiResponse(200, { ok: true, status: 'READY', totalFieldCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateRequiredForm({
        orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
        patch: { status: 'FAILED', errorMessage: message },
      });
      return apiResponse(500, { message: `Reprocessing failed: ${message}` });
    }
  }

  try {
    const jobId = await startFormsAnalysis({
      bucket: requireEnv('DOCUMENTS_BUCKET'),
      fileKey: form.sourceFileKey,
      jobTag: form.formId,
      snsTopicArn: requireEnv('TEXTRACT_FORMS_SNS_TOPIC_ARN'),
      roleArn: requireEnv('TEXTRACT_FORMS_ROLE_ARN'),
    });
    return apiResponse(202, { ok: true, jobId, status: 'IN_PROGRESS' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRequiredForm({
      orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
      patch: { status: 'FAILED', errorMessage: message },
    });
    return apiResponse(500, { message: `Reprocessing failed to start: ${message}` });
  }
};

// DOCX forms are buffered fully into memory before mammoth parses them. Cap the
// size while streaming so an unexpectedly large source file can't exhaust the
// Lambda's memory — we abort as soon as the accumulated bytes exceed the limit
// rather than after the whole object is in memory. 25MB comfortably covers real
// solicitation Word docs; anything larger is surfaced as a FAILED reprocess.
const MAX_DOCX_BYTES = 25 * 1024 * 1024;

const streamToBuffer = async (stream: unknown): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_DOCX_BYTES) {
      throw new Error(`DOCX file exceeds the ${MAX_DOCX_BYTES / (1024 * 1024)}MB reprocessing limit`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
