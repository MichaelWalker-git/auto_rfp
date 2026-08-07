import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import mammoth from 'mammoth';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getRequiredForm } from '@/helpers/required-form';
import { getFileBufferFromS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import { injectFieldMarkers } from '@/helpers/docx-fill-spots';
import JSZip from 'jszip';

import {
  AuthedEvent,
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const QuerySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  formId: z.string().min(1),
});

/**
 * Render a DOCX form's source document to HTML for the in-context editor. The
 * frontend sanitizes the HTML (dompurify) and swaps invisible field markers for
 * interactive spans, so it can highlight and live-fill each spot. This is a
 * one-way, layout-tolerant conversion — it does NOT round-trip, so mammoth's
 * lossy HTML is acceptable.
 *
 * We inject invisible markers at every fill spot (via the SAME finder the
 * detector/filler use) BEFORE running mammoth, so each marker lands at the
 * correct visual position in the HTML. The returned `spots[]` is index-aligned
 * with those markers; the frontend maps marker index → spot → the sidebar field
 * that shares (kind, ref, occurrence).
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { success, data, error } = QuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const form = await getRequiredForm({ orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  // Only .docx is renderable: mammoth/JSZip read the OOXML zip, not the legacy
  // OLE .doc format (which is rejected at intake — see unsupported-file-type.ts).
  const lowerKey = form.sourceFileKey.toLowerCase();
  if (!lowerKey.endsWith('.docx')) {
    return apiResponse(400, { message: 'Preview is only supported for .docx documents' });
  }

  const buffer = await getFileBufferFromS3(getDocumentsBucket(), form.sourceFileKey);

  // Inject field markers into document.xml, re-zip, then convert to HTML. A
  // malformed/non-OOXML file makes JSZip/mammoth throw; treat that as "no
  // preview available" (html: null) rather than a 500 — the editor renders a
  // graceful "Preview unavailable" state and the field sidebar still works.
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    let spots: ReturnType<typeof injectFieldMarkers>['spots'] = [];
    if (documentXml) {
      const marked = injectFieldMarkers(documentXml);
      spots = marked.spots;
      zip.file('word/document.xml', marked.xml);
    }
    const markedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const { value: html } = await mammoth.convertToHtml({ buffer: markedBuffer });
    return apiResponse(200, { html, fileName: form.sourceFileName, spots });
  } catch (err) {
    console.warn(`DOCX preview render failed for ${form.sourceFileKey}: ${err instanceof Error ? err.message : String(err)}`);
    return apiResponse(200, { html: null, fileName: form.sourceFileName, spots: [] });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
