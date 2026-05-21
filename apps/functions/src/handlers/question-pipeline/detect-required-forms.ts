import { requireEnv } from '@/helpers/env';
import { loadTextFromS3, copyS3Object } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { getQuestionFileItem, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { createRequiredForm, listRequiredFormsByOpportunity, updateRequiredForm } from '@/helpers/required-form';
import { startFormsAnalysis } from '@/helpers/textract-forms';
import { parseXlsxForms } from '@/helpers/xlsx-form-parser';
import { autofillMatrixComments } from '@/helpers/matrix-autofill';
import { withSentryLambda } from '@/sentry-lambda';

import type { DetectedFormField, FormType } from '@auto-rfp/core';
import { FormTypeSchema } from '@auto-rfp/core';

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');
const getTextractFormsSnsTopicArn = () => requireEnv('TEXTRACT_FORMS_SNS_TOPIC_ARN');
const getTextractFormsRoleArn = () => requireEnv('TEXTRACT_FORMS_ROLE_ARN');

type DetectRequiredFormsEvent = {
  textFileKey: string;
  sourceFileKey: string;
  mimeType: string;
  projectId: string;
  opportunityId: string;
  questionFileId: string;
  orgId?: string;
  docType?: string;
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

export const baseHandler = async (
  event: DetectRequiredFormsEvent,
): Promise<DetectRequiredFormsResult> => {
  const { textFileKey, sourceFileKey, mimeType, projectId, opportunityId, questionFileId, docType } = event;

  if (docType && docType !== 'REQUIRED_FORM') {
    console.log(`Skipping form detection — docType is "${docType}", not REQUIRED_FORM`);
    return { ok: true, formsDetected: 0 };
  }

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

  const existingForms = await listRequiredFormsByOpportunity({ orgId, projectId, opportunityId });
  const existingFormNames = new Set(existingForms.map((f) => f.name.toLowerCase().trim()));

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

  if (confidence < 0.5 || forms.length === 0) {
    console.log(`No forms detected (confidence=${confidence}, count=${forms.length}) for ${sourceFileKey}`);
    return { ok: true, formsDetected: 0 };
  }

  const sourceFileName = sourceFileKey.split('/').pop() ?? sourceFileKey;
  const isPdf = mimeType.includes('pdf') || sourceFileKey.toLowerCase().endsWith('.pdf');
  const isXlsx = mimeType.includes('spreadsheet') || mimeType.includes('excel') ||
    sourceFileKey.toLowerCase().endsWith('.xlsx') || sourceFileKey.toLowerCase().endsWith('.xls');

  let createdCount = 0;

  for (const form of forms) {
    const formName = form.name || `Form from ${sourceFileName}`;
    if (existingFormNames.has(formName.toLowerCase().trim())) {
      console.log(`Skipping duplicate form: "${formName}"`);
      continue;
    }

    const parsedType = FormTypeSchema.safeParse(form.formType);
    const validFormType: FormType = parsedType.success ? parsedType.data : 'PDF_SCANNED';

    // Stable file key for the form's lifecycle. We use a content-addressable timestamp
    // because we need this path before we have a formId (UpdateRequiredFormDTO doesn't allow sourceFileKey).
    const stableFolder = `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stableFileKey = `${orgId}/${projectId}/${opportunityId}/required-forms/${stableFolder}/${sourceFileName}`;
    await copyS3Object(getDocumentsBucket(), sourceFileKey, stableFileKey);

    const placeholderFields: DetectedFormField[] = [];

    const { formId } = await createRequiredForm({
      dto: {
        orgId,
        projectId,
        opportunityId,
        name: formName,
        formType: validFormType,
        sourceFileName,
        sourceFileKey: stableFileKey,
        sourcePageRange: form.pageRange ?? null,
        sourceSheetName: form.sheetName ?? null,
      },
      fields: placeholderFields,
    });

    if (isPdf) {
      try {
        await updateRequiredForm({
          orgId, projectId, opportunityId, formId,
          patch: { status: 'IN_PROGRESS' },
        });
        const jobId = await startFormsAnalysis({
          bucket: getDocumentsBucket(),
          fileKey: stableFileKey,
          jobTag: formId,
          snsTopicArn: getTextractFormsSnsTopicArn(),
          roleArn: getTextractFormsRoleArn(),
        });
        console.log(`Started Textract FORMS job ${jobId} for form ${formId} (${formName})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to start Textract FORMS for form ${formId}: ${message}`);
        await updateRequiredForm({
          orgId, projectId, opportunityId, formId,
          patch: { status: 'FAILED', errorMessage: message },
        });
      }
    } else if (isXlsx) {
      // XLSX forms parse synchronously — no Textract roundtrip needed
      try {
        const sheets = await parseXlsxForms(stableFileKey);
        const target = sheets[0];
        let fields = target?.fields ?? [];

        // For matrix forms, run Bedrock against the org's CompanyProfile
        // CAPABILITY entries to populate the Comments column. Response
        // columns stay MANUAL_REQUIRED — autofill never claims compliance.
        if (validFormType === 'XLSX_MATRIX' && fields.length > 0) {
          fields = await autofillMatrixComments({ orgId, fields });
        }

        const total = fields.length;
        const manual = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
        const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;
        const autoFillPercentage = total > 0 ? Math.round((autoFilled / total) * 100) : 0;

        await updateRequiredForm({
          orgId, projectId, opportunityId, formId,
          patch: {
            fields,
            status: 'READY',
            totalFieldCount: total,
            manualFieldCount: manual,
            autoFillPercentage,
            // Matrix forms always require human review before submission.
            reviewRequired: validFormType === 'XLSX_MATRIX' ? true : undefined,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`XLSX parse failed for form ${formId}: ${message}`);
        await updateRequiredForm({
          orgId, projectId, opportunityId, formId,
          patch: { status: 'FAILED', errorMessage: message },
        });
      }
    } else {
      // Unknown mime type — leave the form record in NEW state for manual triage
      console.warn(`Form ${formId} has unsupported mimeType ${mimeType}; left in NEW state`);
    }

    existingFormNames.add(formName.toLowerCase().trim());
    createdCount++;
  }

  return { ok: true, formsDetected: createdCount };
};

export const handler = withSentryLambda(baseHandler);
