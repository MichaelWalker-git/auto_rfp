import type { Context } from 'aws-lambda';
import { requireEnv } from '@/helpers/env';
import { loadTextFromS3 } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { withSentryLambda } from '@/sentry-lambda';

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

export interface ClassifyDocumentEvent {
  questionFileId: string;
  projectId: string;
  opportunityId: string;
  textFileKey: string;
  sourceFileKey: string;
  mimeType: string;
}

export interface ClassifyDocumentResult {
  docType: 'QUESTIONNAIRE' | 'REQUIRED_FORM' | 'OTHER';
  questionColumn?: string;
  answerColumn?: string;
  firstDataRow?: number;
  sheetName?: string;
}

const MAX_TEXT_FOR_CLASSIFICATION = 30000;

const getClassificationPrompt = (): string => `
You are an expert at analyzing procurement documents. Your task is to classify a document into one of three categories: QUESTIONNAIRE, REQUIRED_FORM, or OTHER.

## QUESTIONNAIRE
A structured document (typically a spreadsheet) where:
- There is a column containing questions that a vendor must answer
- There is a designated column where the vendor should write their answers
- Questions are arranged in rows, one per row
- The document expects the vendor to fill in responses in specific cells/columns

Examples: Excel spreadsheets with "Question" and "Response" columns, compliance matrices with "Requirement" and "Vendor Response" columns, technical evaluation forms with numbered questions and answer cells, past performance questionnaires.

## REQUIRED_FORM
A vendor-fillable form that requires specific company/project information (NOT questions requiring substantive written answers):
- Certification forms, representations, and declarations
- Company information forms (name, address, DUNS, CAGE code, etc.)
- Tax exemption certificates, insurance forms
- Compliance checklists with yes/no checkboxes
- Registration or contact forms
- Pricing/CLIN tables to fill with rates (not open-ended cost narrative)

## OTHER
Any document that is NOT a questionnaire or fillable form:
- Narrative RFP documents (PDFs, Word docs with prose)
- Statements of Work
- Contract documents
- Administrative instructions

Respond with ONLY valid JSON (no markdown, no commentary):

If QUESTIONNAIRE:
{
  "docType": "QUESTIONNAIRE",
  "questionColumn": "<column letter containing questions, e.g. 'B'>",
  "answerColumn": "<column letter where answers should go, e.g. 'C'>",
  "firstDataRow": <row number where the first question starts (1-indexed), e.g. 3>,
  "sheetName": "<worksheet name containing the Q&A, or empty string if unknown>"
}

If REQUIRED_FORM:
{
  "docType": "REQUIRED_FORM"
}

If OTHER:
{
  "docType": "OTHER"
}

Rules:
- Only classify as QUESTIONNAIRE if you are highly confident the document has a structured Q&A column format with substantive questions requiring written answers.
- Classify as REQUIRED_FORM if the document is a fillable form requiring company data, certifications, or simple field entries.
- When in doubt, classify as OTHER.
- Column letters should be uppercase (A, B, C, etc.).
- firstDataRow should skip any header rows.
- For non-spreadsheet documents (PDF, DOCX), only classify as QUESTIONNAIRE if the content clearly represents a tabular Q&A format.
`.trim();

const buildClassificationBody = (text: string, mimeType: string, sourceFileKey: string) => {
  const truncatedText = text.slice(0, MAX_TEXT_FOR_CLASSIFICATION);

  return {
    anthropic_version: 'bedrock-2023-05-31',
    system: getClassificationPrompt(),
    messages: [
      {
        role: 'user',
        content: `Classify this document. File: "${sourceFileKey}" (${mimeType})\n\nDOCUMENT TEXT:\n${truncatedText}`,
      },
    ],
    max_tokens: 512,
    temperature: 0,
  };
};

export const baseHandler = async (
  event: ClassifyDocumentEvent,
  _ctx: Context,
): Promise<ClassifyDocumentResult> => {
  const { questionFileId, projectId, opportunityId, textFileKey, sourceFileKey, mimeType } = event;

  if (projectId && opportunityId && questionFileId) {
    const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
    if (isCancelled) {
      console.log(`Pipeline cancelled for ${questionFileId}, skipping classification`);
      return { docType: 'OTHER' };
    }
  }

  const missingFields = [
    !projectId && 'projectId',
    !questionFileId && 'questionFileId',
    !textFileKey && 'textFileKey',
    !opportunityId && 'opportunityId',
  ].filter(Boolean) as string[];

  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }

  let result: ClassifyDocumentResult = { docType: 'OTHER' };

  try {
    const text = await loadTextFromS3(getDocumentsBucket(), textFileKey);
    console.log(`Loaded text for classification: ${text.length} characters`);

    const body = buildClassificationBody(text, mimeType, sourceFileKey);
    const responseBody = await invokeModel(getBedrockModelId(), JSON.stringify(body));
    const jsonTxt = new TextDecoder('utf-8').decode(responseBody);

    const outer = JSON.parse(jsonTxt) as Record<string, unknown>;
    const assistantText = (outer?.content as Array<{ text?: string }>)?.[0]?.text;

    if (!assistantText) {
      console.warn('Model returned no text content for classification, defaulting to OTHER');
      return result;
    }

    const parsed = safeParseJsonFromModel(assistantText) as Record<string, unknown>;

    if (parsed.docType === 'QUESTIONNAIRE') {
      result = {
        docType: 'QUESTIONNAIRE',
        questionColumn: typeof parsed.questionColumn === 'string' ? parsed.questionColumn : undefined,
        answerColumn: typeof parsed.answerColumn === 'string' ? parsed.answerColumn : undefined,
        firstDataRow: typeof parsed.firstDataRow === 'number' ? parsed.firstDataRow : undefined,
        sheetName: typeof parsed.sheetName === 'string' && parsed.sheetName !== '' ? parsed.sheetName : undefined,
      };
    } else if (parsed.docType === 'REQUIRED_FORM') {
      result = { docType: 'REQUIRED_FORM' };
    }
  } catch (err: unknown) {
    console.error('Classification failed, defaulting to OTHER:', (err as Error)?.message);
  }

  console.log(`Classification result for ${questionFileId}: ${JSON.stringify(result)}`);

  await updateQuestionFile(projectId, opportunityId, questionFileId, {
    docType: result.docType,
    ...(result.questionColumn && { questionColumn: result.questionColumn }),
    ...(result.answerColumn && { answerColumn: result.answerColumn }),
    ...(result.firstDataRow && { firstDataRow: result.firstDataRow }),
    ...(result.sheetName && { sheetName: result.sheetName }),
  });

  return result;
};

export const handler = withSentryLambda(baseHandler);
