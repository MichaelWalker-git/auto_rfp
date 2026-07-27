import { requireEnv } from '@/helpers/env';
import { loadTextFromS3, copyS3Object } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { getQuestionFileItem, checkQuestionFileCancelled, updateQuestionFile } from '@/helpers/questionFile';
import { createRequiredForm, listRequiredFormsByOpportunity, updateRequiredForm } from '@/helpers/required-form';
import { markFormsReadyIfAllDone } from '@/helpers/mark-forms-ready';
import { startFormsAnalysis } from '@/helpers/textract-forms';
import { parseXlsxForms } from '@/helpers/xlsx-form-parser';
import { extractAndAutofillDocxForm } from '@/helpers/docx-form-parser';
import { autofillMatrixComments } from '@/helpers/matrix-autofill';
import { withSentryLambda } from '@/sentry-lambda';

import type { DetectedFormField, FormType } from '@auto-rfp/core';
import { FormTypeSchema } from '@auto-rfp/core';

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
// Model for the whole-document form-DETECTION scan (kept as a separate env var
// from BEDROCK_MODEL_ID, which drives autofill, so the two can be tuned apart).
// Defaults to Opus: a Haiku trial regressed detection quality on real 100+ page
// PDFs — false-positive "forms" from decorative underlines/numbered lists, and
// mis-scoped page ranges pulling unrelated fields. Detection accuracy gates what
// forms users see, so correctness wins over the scan-cost saving. Override
// DETECTION_MODEL_ID per-deploy to trial a cheaper model behind an eval.
const getDetectionModelId = () =>
  requireEnv('DETECTION_MODEL_ID', 'us.anthropic.claude-opus-4-6-v1');
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

// Detection must scan the WHOLE document — a required form can appear anywhere,
// including the last pages of a 100+ page solicitation. We send the doc to the
// model one window at a time: a single call when it fits, chunked only when it
// doesn't. Chunks overlap slightly so a form straddling a boundary is not lost.
const DETECTION_WINDOW_CHARS = 150_000;
const DETECTION_CHUNK_OVERLAP = 500;
// Defensive bound on sequential Bedrock calls so a pathological document degrades
// predictably instead of hitting the Lambda timeout mid-scan. The dropped tail is
// logged (never silently truncated).
const MAX_DETECTION_CHUNKS = 8;

const splitTextIntoChunks = (text: string, maxChars: number, overlap: number): string[] => {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + maxChars / 2) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = text.lastIndexOf('. ', end);
        if (sentenceBreak > start + maxChars / 2) {
          end = sentenceBreak + 1;
        }
      }
    }

    chunks.push(text.substring(start, end));
    start = end - overlap;
    if (start < 0) start = 0;
  }

  return chunks;
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
    '- formType: one of PDF_FILLABLE, PDF_SCANNED, XLSX_MATRIX, XLSX_FORM, DOCX_FORM, CONTRACT_TEMPLATE. ' +
    'Use DOCX_FORM for Word (.docx) documents.\n' +
    '- pageRange: page numbers if identifiable (e.g. "3-5")\n' +
    '- sheetName: sheet/tab name if XLSX\n\n' +
    'Return JSON: { "forms": [...], "confidence": number (0-1) }\n' +
    'If NO forms are detected, return: { "forms": [], "confidence": 1.0 }\n\n' +
    'DOCUMENT TEXT:\n' +
    docText;

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

// Dedup key for form names. When a form straddles a chunk boundary in a long PDF,
// two adjacent chunks can each report it, and the model may label the second half
// with a continuation marker ("Certification Form" vs "Certification Form (cont.)").
// Normalize those variants to the same key so the straddling form is created once.
// Deliberately CONSERVATIVE — we strip only continuation/whitespace/punctuation
// noise, never fuzzy-merge by similarity: merging "Attachment 3" with "Attachment 5"
// would silently drop a genuinely distinct form, which is worse than a duplicate.
const normalizeFormNameKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s+/g, ' ')                                   // collapse internal whitespace
    .replace(/[([{]\s*(cont(inued|\.)?|continued)\s*[)\]}]/g, '') // "(cont.)", "(continued)"
    .replace(/[-–—,]?\s*(cont(inued|\.)?|continued)\s*$/g, '')    // trailing "- continued"
    .replace(/[([{]\s*\d+\s*[)\]}]\s*$/g, '')               // trailing page-ish "(2)"
    .replace(/[^a-z0-9 ]/g, '')                             // drop remaining punctuation
    .trim();

export const baseHandler = async (
  event: DetectRequiredFormsEvent,
): Promise<DetectRequiredFormsResult> => {
  const { textFileKey, sourceFileKey, mimeType, projectId, opportunityId, questionFileId, docType } = event;

  // Run detection for everything EXCEPT questionnaires. Questionnaires are standalone
  // Q&A files with no vendor forms, and the classifier reliably labels them from the
  // first pages. For any other docType (OTHER, REQUIRED_FORM, or missing) we scan for
  // forms — the classifier's 30k-char window can't see forms late in a long document,
  // so we must not gate detection on it having guessed REQUIRED_FORM. docType is
  // promoted to REQUIRED_FORM below if forms are actually found.
  if (docType === 'QUESTIONNAIRE') {
    console.log('Skipping form detection — docType is "QUESTIONNAIRE"');
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
  const existingFormNames = new Set(existingForms.map((f) => normalizeFormNameKey(f.name)));

  const docText = await loadTextFromS3(getDocumentsBucket(), textFileKey);
  if (!docText || docText.length === 0) {
    console.log(`Empty text for ${textFileKey}, skipping form detection`);
    return { ok: true, formsDetected: 0 };
  }

  // Scan the whole document, one window at a time. A single chunk for docs that
  // fit DETECTION_WINDOW_CHARS; more only when the document is larger.
  const allChunks = splitTextIntoChunks(docText, DETECTION_WINDOW_CHARS, DETECTION_CHUNK_OVERLAP);
  const chunks = allChunks.slice(0, MAX_DETECTION_CHUNKS);
  if (allChunks.length > MAX_DETECTION_CHUNKS) {
    const scannedChars = chunks.reduce((n, c) => n + c.length, 0);
    console.warn(
      `Form detection truncated for ${sourceFileKey}: scanned ${chunks.length}/${allChunks.length} chunks ` +
      `(${scannedChars} of ${docText.length} chars). Forms beyond chunk ${MAX_DETECTION_CHUNKS} were not scanned.`,
    );
  }

  // Merge forms across every chunk that clears the confidence bar. Sequential
  // calls (not parallel) to avoid Bedrock throttling on multi-chunk documents.
  const forms: DetectedFormResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const responseBody = await invokeModel(
      getDetectionModelId(),
      JSON.stringify(buildDetectionPrompt(chunks[i], mimeType)),
    );
    const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
    const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;
    const modelOut = rawText ? (safeParseJsonFromModel(String(rawText)) as Record<string, unknown>) : null;

    if (!modelOut) {
      console.log(`Form detection returned non-JSON for ${sourceFileKey} chunk ${i + 1}/${chunks.length}, skipping chunk`);
      continue;
    }

    const confidence = typeof modelOut.confidence === 'number' ? modelOut.confidence : 0;
    const chunkForms = Array.isArray(modelOut.forms) ? (modelOut.forms as DetectedFormResult[]) : [];

    if (confidence < 0.5 || chunkForms.length === 0) {
      console.log(`No forms in chunk ${i + 1}/${chunks.length} (confidence=${confidence}, count=${chunkForms.length}) for ${sourceFileKey}`);
      continue;
    }

    forms.push(...chunkForms);
  }

  if (forms.length === 0) {
    console.log(`No forms detected across ${chunks.length} chunk(s) for ${sourceFileKey}`);
    return { ok: true, formsDetected: 0 };
  }

  const sourceFileName = sourceFileKey.split('/').pop() ?? sourceFileKey;
  const isPdf = mimeType.includes('pdf') || sourceFileKey.toLowerCase().endsWith('.pdf');
  const isXlsx = mimeType.includes('spreadsheet') || mimeType.includes('excel') ||
    sourceFileKey.toLowerCase().endsWith('.xlsx') || sourceFileKey.toLowerCase().endsWith('.xls');
  const isDocx = mimeType.includes('wordprocessingml') || mimeType.includes('msword') ||
    sourceFileKey.toLowerCase().endsWith('.docx') || sourceFileKey.toLowerCase().endsWith('.doc');

  // A single XLSX/DOCX file is ONE form. Unlike PDFs — where each detected form
  // occupies a distinct page range that Textract can isolate via sourcePageRange —
  // the XLSX and DOCX parsers read the ENTIRE file regardless of how many forms the
  // model named (parseXlsxForms merges every sheet; parseDocxForms reads the whole
  // text). So if the model splits one workbook/document into N forms, each record
  // would be populated with the identical whole-file field set — pure duplication
  // (and duplicated parse/autofill work). Collapse to a single record per source
  // file; keep the first detected form's name/type as the representative. PDFs keep
  // all detected forms because their page-range partitioning is real.
  const formsToCreate = isXlsx || isDocx ? forms.slice(0, 1) : forms;
  if (formsToCreate.length < forms.length) {
    console.log(
      `Collapsed ${forms.length} detected forms to 1 for single-file type (${sourceFileName}) — ` +
      'XLSX/DOCX parse the whole file, so multiple records would be identical duplicates.',
    );
  }

  let createdCount = 0;

  for (const form of formsToCreate) {
    const formName = form.name || `Form from ${sourceFileName}`;
    if (existingFormNames.has(normalizeFormNameKey(formName))) {
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
        // Merge fields across every sheet that yielded fields. Instruction-only
        // sheets produce none and are naturally excluded. The parser only returns
        // sheets with content, so a workbook whose real fields live on sheet 2+
        // (instructions on sheet 1) is preserved instead of being dropped.
        let fields = sheets.flatMap((s) => s.fields);
        // Matrix wins if any content sheet is a matrix — matrices always require
        // human review and drive the reviewRequired flag below.
        const detectedFormType: FormType = sheets.some((s) => s.formType === 'XLSX_MATRIX')
          ? 'XLSX_MATRIX'
          : validFormType;

        // For matrix forms, run Bedrock against the org's CompanyProfile
        // CAPABILITY entries to populate the Comments column. Response
        // columns stay MANUAL_REQUIRED — autofill never claims compliance.
        if (detectedFormType === 'XLSX_MATRIX' && fields.length > 0) {
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
            reviewRequired: detectedFormType === 'XLSX_MATRIX' ? true : undefined,
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
    } else if (isDocx) {
      // DOCX forms have no PDF/Textract geometry. Extract fields from the text
      // we already loaded, then autofill from the company profile exactly like
      // the Textract callback does for PDFs. Fields carry a null boundingBox.
      try {
        await updateRequiredForm({
          orgId, projectId, opportunityId, formId,
          patch: { status: 'IN_PROGRESS' },
        });

        const { fields, totalFieldCount, manualFieldCount, autoFillPercentage } =
          await extractAndAutofillDocxForm(docText, orgId);

        await updateRequiredForm({
          orgId, projectId, opportunityId, formId,
          patch: {
            fields,
            status: 'READY',
            totalFieldCount,
            manualFieldCount,
            autoFillPercentage,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`DOCX form parse failed for form ${formId}: ${message}`);
        await updateRequiredForm({
          orgId, projectId, opportunityId, formId,
          patch: { status: 'FAILED', errorMessage: message },
        });
      }
    } else {
      // Unsupported mime type for automated field extraction (e.g. an image
      // solicitation: png/jpg/tiff). There is no parser for it, so mark the form
      // FAILED rather than leaving it NEW. NEW is a non-terminal state, so
      // markFormsReadyIfAllDone would treat it as still-pending and the question
      // file would stay stuck in FILLING_FORMS forever. FAILED is terminal, so the
      // readiness check below can complete; the form still surfaces for manual triage.
      const message = `Unsupported mimeType for form field extraction: ${mimeType}`;
      console.warn(`Form ${formId}: ${message}`);
      await updateRequiredForm({
        orgId, projectId, opportunityId, formId,
        patch: { status: 'FAILED', errorMessage: message },
      });
    }

    existingFormNames.add(normalizeFormNameKey(formName));
    createdCount++;
  }

  // If we created at least one form, mark the question file as FILLING_FORMS
  // so the UI can surface that downstream form-fill processing is running.
  // Also promote docType to REQUIRED_FORM (promote-only, never demote) — for long
  // documents the classifier may have labelled this OTHER because the forms live
  // past its 30k-char window; finding a form here is the authoritative signal.
  if (createdCount > 0) {
    const patch: Parameters<typeof updateQuestionFile>[3] =
      docType === 'REQUIRED_FORM'
        ? { status: 'FILLING_FORMS' }
        : { status: 'FILLING_FORMS', docType: 'REQUIRED_FORM' };
    await updateQuestionFile(projectId, opportunityId, questionFileId, patch)
      .catch((err) => console.warn(`Failed to set FILLING_FORMS on ${questionFileId}:`, (err as Error)?.message));

    // XLSX/DOCX forms are parsed to READY inline above (no async Textract job),
    // so nothing else would flip the question file out of FILLING_FORMS for a
    // pure-spreadsheet/Word opportunity. Attempt the FORMS_READY transition now:
    // it's a no-op while any form is still pending (e.g. a PDF form awaiting the
    // Textract callback in a mixed opportunity), and the Textract callback runs
    // the same check when it terminates — whichever path finishes last wins.
    await markFormsReadyIfAllDone(orgId, projectId, opportunityId);
  }

  return { ok: true, formsDetected: createdCount };
};

export const handler = withSentryLambda(baseHandler);
