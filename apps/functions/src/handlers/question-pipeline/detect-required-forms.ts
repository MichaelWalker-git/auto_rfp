import { v4 as uuidv4 } from 'uuid';

import { requireEnv } from '@/helpers/env';
import { loadTextFromS3 } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { getQuestionFileItem, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { getCompanyProfile } from '@/helpers/company-profile';
import { gatherAllContext } from '@/helpers/document-context';
import { putRFPDocument, listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { extractFormFieldsWithVision } from '@/helpers/extract-form-fields-vision';
import { matchFieldsToProfile } from '@/helpers/form-field-matcher';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { buildRFPDocumentSK } from '@/helpers/rfp-document';
import { withSentryLambda } from '@/sentry-lambda';

import type { DetectedFormField, FormFieldStatus, FormType } from '@auto-rfp/core';
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
    'Analyze the following document text and identify any REQUIRED VENDOR FORMS that must be filled out and submitted.\n\n' +
    'A document IS a form if it has:\n' +
    '- Blank lines/underscores where the vendor must write information (company name, address, EIN, signature)\n' +
    '- A response matrix with columns the vendor must fill (Fully Meets / Partially Meets / Cannot Meet)\n' +
    '- Fillable form fields or labeled blanks (e.g. "Company Name: ___")\n' +
    '- Signature blocks that require the vendor to sign\n\n' +
    'A document is NOT a form if it:\n' +
    '- Is purely informational (scope of work, terms and conditions with no blanks to fill)\n' +
    '- Is a notice, addendum, or instruction document with no vendor-fillable fields\n' +
    '- Contains only pre-filled government data with nothing for the vendor to complete\n\n' +
    'Only return documents that have ACTUAL BLANKS, FIELDS, OR CELLS that the vendor must fill in.\n\n' +
    'For each form found, return:\n' +
    '- name: descriptive form title\n' +
    '- formType: one of PDF_FILLABLE, PDF_SCANNED, XLSX_MATRIX, XLSX_FORM, CONTRACT_TEMPLATE\n' +
    '- pageRange: page numbers if identifiable (e.g. "3-5")\n' +
    '- sheetName: sheet/tab name if XLSX\n\n' +
    'Return JSON: { "forms": [...], "confidence": number (0-1) }\n' +
    'If NO forms are detected, return: { "forms": [], "confidence": 1.0 }\n\n' +
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

    if (!modelOut) {
      console.log(`Form detection returned non-JSON for ${sourceFileKey}, skipping`);
      return { ok: true, formsDetected: 0 };
    }

    const confidence = typeof modelOut.confidence === 'number' ? modelOut.confidence : 0;
    const forms = Array.isArray(modelOut.forms) ? (modelOut.forms as DetectedFormResult[]) : [];

    if (confidence < 0.5) {
      console.log(`Low confidence (${confidence}) for form detection in ${sourceFileKey}, skipping`);
      return { ok: true, formsDetected: 0 };
    }

    if (forms.length === 0) {
      console.log(`No forms detected in ${sourceFileKey}`);
      return { ok: true, formsDetected: 0 };
    }

    const sourceFileName = sourceFileKey.split('/').pop() ?? sourceFileKey;

    // Load company profile + KB context for auto-fill
    const [profile, knowledgeContext] = await Promise.all([
      getCompanyProfile(orgId),
      gatherAllContext({ projectId, orgId, opportunityId, solicitation: docText.slice(0, 10_000) })
        .catch((err) => { console.warn('KB context load failed (non-fatal):', (err as Error)?.message); return ''; }),
    ]);

    // Extract form fields using Claude vision (sends actual file for accurate field detection)
    let detectedFields: DetectedFormField[] = [];
    const isPdf = mimeType.includes('pdf') || sourceFileKey.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      try {
        detectedFields = await extractFormFieldsWithVision(sourceFileKey);
        console.log(`Vision extracted ${detectedFields.length} fields from ${sourceFileName}`);
      } catch (err) {
        console.warn(`Vision field extraction failed for ${sourceFileName} (non-fatal):`, (err as Error)?.message);
      }
    }

    // Auto-fill fields from company profile
    if (profile && detectedFields.length > 0) {
      try {
        const matchResults = await matchFieldsToProfile(detectedFields, profile);
        detectedFields = detectedFields.map((f) => {
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
      } catch (err) {
        console.warn('Field matching failed (non-fatal):', (err as Error)?.message);
      }
    }

    let createdCount = 0;
    for (const form of forms) {
      const formName = form.name || `Form from ${sourceFileName}`;
      if (existingFormNames.has(formName.toLowerCase().trim())) {
        console.log(`Skipping duplicate form: "${formName}"`);
        continue;
      }

      const parsedType = FormTypeSchema.safeParse(form.formType);
      const validFormType: FormType = parsedType.success ? parsedType.data : 'PDF_SCANNED';

      const autoFilledCount = detectedFields.filter((f) => f.status === 'AUTO_FILLED').length;
      const hasUnfilled = detectedFields.some((f) => f.status === 'EMPTY' || f.status === 'MANUAL_REQUIRED');
      const formStatus = detectedFields.length === 0 ? 'DRAFT' : (hasUnfilled ? 'DRAFT' : 'NEEDS_REVIEW');

      const documentId = uuidv4();
      const now = nowIso();

      // Copy source file to a stable RFP document location (never modify the original)
      const { copyS3Object } = await import('@/helpers/s3');
      const stableFileKey = `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/source/${sourceFileName}`;
      await copyS3Object(getDocumentsBucket(), sourceFileKey, stableFileKey);

      await putRFPDocument({
        [PK_NAME]: RFP_DOCUMENT_PK,
        [SK_NAME]: buildRFPDocumentSK(projectId, opportunityId, documentId),
        documentId,
        projectId,
        opportunityId,
        orgId,
        name: formName,
        description: `Required form from ${sourceFileName}. ${autoFilledCount}/${detectedFields.length} fields auto-filled.`,
        documentType: 'REQUIRED_FORM',
        mimeType: mimeType || 'application/pdf',
        fileSizeBytes: 0,
        originalFileName: sourceFileName,
        fileKey: stableFileKey,
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
          outlineSummary: `Required vendor form. Type: ${validFormType}.`,
        },
        status: formStatus,
        title: formName,
        htmlContentKey: null,
        editHistory: null,
        googleDriveFileId: null,
        googleDriveUrl: null,
        generationError: null,
        formFields: detectedFields,
        pageImagesKey: null,
      });

      existingFormNames.add(formName.toLowerCase().trim());
      createdCount++;
      console.log(`Created REQUIRED_FORM "${formName}" (${documentId}): ${detectedFields.length} fields, ${autoFilledCount} auto-filled, status=${formStatus}`);
    }

    return { ok: true, formsDetected: createdCount };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('detect-required-forms error:', message);
    return { ok: false, formsDetected: 0 };
  }
};

export const handler = withSentryLambda(baseHandler);
