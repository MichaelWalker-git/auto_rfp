import { v4 as uuidv4 } from 'uuid';

import { requireEnv } from '@/helpers/env';
import { loadTextFromS3 } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { getQuestionFileItem, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { getCompanyProfile } from '@/helpers/company-profile';
import { gatherAllContext } from '@/helpers/document-context';
import { putRFPDocument, uploadRFPDocumentHtml, listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { generateFormHtml } from '@/helpers/form-html-generator';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { buildRFPDocumentSK } from '@/helpers/rfp-document';
import { withSentryLambda } from '@/sentry-lambda';

import type { FormType } from '@auto-rfp/core';
import { FormTypeSchema } from '@auto-rfp/core';

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

type DetectRequiredFormsEvent = {
  textFileKey: string;
  sourceFileKey: string;
  mimeType: string;
  projectId: string;
  opportunityId: string;
  questionFileId: string;
  orgId?: string;
};

type DetectedFormResult = {
  name: string;
  formType: FormType;
  pageRange?: string;
  sheetName?: string;
};

type DetectRequiredFormsResult = {
  ok: boolean;
  formsDetected: number;
  cancelled?: boolean;
};

const buildDetectionPrompt = (docText: string, mimeType: string) => {
  const fileTypeHint = mimeType.includes('spreadsheet') || mimeType.includes('excel')
    ? 'This is an XLSX/Excel file.'
    : mimeType.includes('pdf')
      ? 'This is a PDF file.'
      : 'This is a document file.';

  const userText =
    `${fileTypeHint}\n\n` +
    'Analyze the following document text and identify any REQUIRED VENDOR FORMS that must be filled out and submitted. ' +
    'Look for:\n' +
    '- Fillable form fields (labeled blanks like "Company Name: ___", "EIN: ___")\n' +
    '- Certification/exemption forms with signature blocks\n' +
    '- Requirements response matrices (columns like "Fully Meets / Partially Meets / Cannot Meet")\n' +
    '- Contract templates with inline blanks for vendor information\n' +
    '- Bid schedules or cost sheets requiring vendor input\n\n' +
    'For each form found, return:\n' +
    '- name: descriptive form title\n' +
    '- formType: one of PDF_FILLABLE, PDF_SCANNED, XLSX_MATRIX, XLSX_FORM, CONTRACT_TEMPLATE\n' +
    '- pageRange: page numbers if identifiable (e.g. "3-5")\n' +
    '- sheetName: sheet/tab name if XLSX\n\n' +
    'Return JSON: { "forms": [...], "confidence": number (0-1) }\n' +
    'If NO forms are detected, return: { "forms": [], "confidence": number }\n\n' +
    'DOCUMENT TEXT:\n' +
    docText.slice(0, 150_000);

  return {
    anthropic_version: 'bedrock-2023-05-31',
    system:
      'You detect required vendor forms in government solicitation documents. ' +
      'Return ONLY valid JSON (no markdown, no commentary).',
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    max_tokens: 2000,
  };
};

const nowIso = () => new Date().toISOString();

export const baseHandler = async (
  event: DetectRequiredFormsEvent,
): Promise<DetectRequiredFormsResult> => {
  const { textFileKey, sourceFileKey, mimeType, projectId, opportunityId, questionFileId } = event;

  if (projectId && opportunityId && questionFileId) {
    const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
    if (isCancelled) {
      return { ok: true, formsDetected: 0, cancelled: true };
    }
  }

  if (!textFileKey || !projectId || !opportunityId || !questionFileId) {
    throw new Error('textFileKey, projectId, opportunityId, and questionFileId are all required');
  }

  let orgId = event.orgId;
  if (!orgId) {
    const qf = await getQuestionFileItem(projectId, opportunityId, questionFileId);
    orgId = qf?.orgId;
  }

  if (!orgId) {
    throw new Error('Could not determine orgId');
  }

  try {
    const existingDocs = await listRFPDocumentsByProject({ projectId, opportunityId });
    const existingFormNames = new Set(
      existingDocs.items
        .filter((d) => d.documentType === 'REQUIRED_FORM')
        .map((d) => (d.name as string).toLowerCase().trim()),
    );

    const docText = await loadTextFromS3(getDocumentsBucket(), textFileKey);
    if (!docText || docText.length === 0) {
      console.log(`Empty text for ${textFileKey}, skipping form detection`);
      return { ok: true, formsDetected: 0 };
    }

    const responseBody = await invokeModel(
      getBedrockModelId(),
      JSON.stringify(buildDetectionPrompt(docText, mimeType)),
    );
    const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;

    const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;

    const modelOut = rawText ? (safeParseJsonFromModel(String(rawText)) as Record<string, unknown>) : null;

    const forms = Array.isArray(modelOut?.forms)
      ? (modelOut.forms as DetectedFormResult[])
      : [];

    if (forms.length === 0) {
      console.log(`No forms detected in ${sourceFileKey}`);
      return { ok: true, formsDetected: 0 };
    }

    const sourceFileName = sourceFileKey.split('/').pop() ?? sourceFileKey;

    const [profile, knowledgeContext] = await Promise.all([
      getCompanyProfile(orgId),
      gatherAllContext({ projectId, orgId, opportunityId, solicitation: docText.slice(0, 10_000) })
        .catch((err) => { console.warn('KB context load failed (non-fatal):', (err as Error)?.message); return ''; }),
    ]);

    let createdCount = 0;
    for (const form of forms) {
      const formName = form.name || `Form from ${sourceFileName}`;
      if (existingFormNames.has(formName.toLowerCase().trim())) {
        console.log(`Skipping duplicate form: "${formName}"`);
        continue;
      }

      const parsedType = FormTypeSchema.safeParse(form.formType);
      const validFormType: FormType = parsedType.success ? parsedType.data : 'PDF_SCANNED';

      const html = await generateFormHtml({
        formName,
        sourceFileName,
        sourceFileKey,
        mimeType,
        documentText: docText,
        fields: [],
        profile,
        knowledgeContext,
      });

      // Determine status: if HTML has unfilled placeholders (gray fields), it's DRAFT.
      // If all fields were filled by AI, it's NEEDS_REVIEW (human should verify).
      const hasUnfilledFields = html.includes('color: #9ca3af') || html.includes('color:#9ca3af');
      const formStatus = hasUnfilledFields ? 'DRAFT' : 'NEEDS_REVIEW';

      const documentId = uuidv4();
      const now = nowIso();

      const htmlContentKey = await uploadRFPDocumentHtml({
        orgId,
        projectId,
        opportunityId,
        documentId,
        html,
      });

      await putRFPDocument({
        [PK_NAME]: RFP_DOCUMENT_PK,
        [SK_NAME]: buildRFPDocumentSK(projectId, opportunityId, documentId),
        documentId,
        projectId,
        opportunityId,
        orgId,
        name: formName,
        description: `Required form detected from ${sourceFileName}.`,
        documentType: 'REQUIRED_FORM',
        mimeType: 'application/json',
        fileSizeBytes: Buffer.byteLength(html, 'utf-8'),
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
        createdBy: 'system',
        updatedBy: 'system',
        createdAt: now,
        updatedAt: now,
        content: {
          title: formName,
          customerName: null,
          opportunityId,
          outlineSummary: `Required vendor form detected from solicitation.`,
        },
        status: formStatus,
        title: formName,
        htmlContentKey,
        editHistory: null,
        googleDriveFileId: null,
        googleDriveUrl: null,
        generationError: null,
      });

      existingFormNames.add(formName.toLowerCase().trim());
      createdCount++;
      console.log(`Created REQUIRED_FORM RFP document "${formName}" (${documentId})`);
    }

    return { ok: true, formsDetected: createdCount };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('detect-required-forms error:', message);
    return { ok: false, formsDetected: 0 };
  }
};

export const handler = withSentryLambda(baseHandler);
