import { Context } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { QUESTION_PK } from '../constants/question';
import { PK_NAME, SK_NAME } from '../constants/common';
import { safeParseJsonFromModel } from '../helpers/json';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { nowIso } from '../helpers/date';
import { loadTextFromS3 } from '../helpers/s3';
import { v4 as uuidv4 } from 'uuid';
import { invokeModel } from '../helpers/bedrock-http-client';
import { updateQuestionFile } from '../helpers/questionFile';
import { GroupedSection } from '@auto-rfp/shared';

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

export interface ExtractQuestionsEvent {
  questionFileId: string;
  projectId: string;
  textFileKey: string;
}

type ExtractedQuestions = { sections: GroupedSection[] }

// TODO Kate
export const baseHandler = async (
  event: ExtractQuestionsEvent,
  _ctx: Context,
): Promise<{ count: number }> => {
  console.log('extract-questions event:', JSON.stringify(event));

  const { questionFileId, projectId, textFileKey } = event;
  if (!questionFileId || !projectId || !textFileKey) {
    throw new Error('questionFileId, projectId, textFileKey are required');
  }
  const text = await loadTextFromS3(DOCUMENTS_BUCKET, textFileKey);

  const extracted = await extractQuestionsWithBedrock(text);

  const totalQuestions = await saveQuestionsFromSections(
    questionFileId,
    projectId,
    extracted,
  );

  await updateQuestionFile(projectId, questionFileId, { status: 'PROCESSED', totalQuestions });

  return { count: totalQuestions };
};

async function extractQuestionsWithBedrock(content: string,): Promise<ExtractedQuestions> {
  const systemPrompt = getSystemPrompt();
  const userPrompt = buildUserPrompt(content);

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    max_tokens: 32768,
    temperature: 0.1,
  };

  const responseBody = await invokeModel(
    BEDROCK_MODEL_ID,
    JSON.stringify(body),
    'application/json',
    'application/json'
  );

  const jsonTxt = new TextDecoder('utf-8').decode(responseBody);

  let outer: any;
  try {
    outer = JSON.parse(jsonTxt);
  } catch {
    console.error('Bad response JSON from Bedrock:', jsonTxt);
    throw new Error('Invalid JSON envelope from Bedrock');
  }

  console.log('Bedrock envelope:', JSON.stringify(outer).slice(0, 2000));

  const stopReason = outer.stop_reason || outer.stopReason;
  const usage = outer.usage;

  console.log('stop_reason:', stopReason, 'usage:', usage);

  const assistantText = outer?.content?.[0]?.text;
  if (!assistantText) {
    throw new Error('Model returned no text content');
  }

  const parsed = safeParseJsonFromModel(assistantText);

  if (!Array.isArray(parsed.sections)) {
    throw new Error('Response missing required sections[]');
  }

  return parsed as ExtractedQuestions;
}

async function saveQuestionsFromSections(
  questionFileId: string,
  projectId: string,
  extracted: ExtractedQuestions,
): Promise<number> {
  const now = nowIso();
  let count = 0;

  const writes: Promise<any>[] = [];

  for (const section of extracted.sections) {
    const sectionId = uuidv4();
    for (const q of section.questions) {
      const questionId = uuidv4();
      const sortKey = `${projectId}#${questionId}`;

      const item = {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: sortKey,
        projectId,
        questionFileId,
        questionId: questionId,
        question: q.question,
        sectionId: sectionId,
        sectionTitle: section.title,
        sectionDescription: section.description ?? null,
        createdAt: now,
        updatedAt: now,
      };

      writes.push(
        docClient.send(
          new PutCommand({
            TableName: DB_TABLE_NAME,
            Item: item,
          }),
        ),
      );

      count++;
    }
  }

  await Promise.all(writes);
  return count;
}

const getSystemPrompt = () => {
  return `
You are an expert at analyzing U.S. government procurement opportunity documents (SAM.gov solicitations, RFPs, RFIs, IFBs, amendments, attachments) and extracting every item that a vendor/offeror must answer, provide, or comply with.

Goal:
Extract all "candidate questions" (anything the vendor must respond to or submit) and organize them by section.

What counts as a candidate question (include all of these):
- Direct questions (ending with "?")
- Prompts / instructions that require a response (e.g., "Provide...", "Describe...", "Explain...", "Submit...", "Include...", "The offeror shall...")
- Requested documents/artifacts (e.g., past performance references, resumes, certifications, plans, narratives)
- Pricing deliverables (pricing tables, CLIN pricing, rate sheets)
- Compliance matrices / representations & certifications / forms to fill
- Submission requirements (format, page limits, file naming, portal steps) when they require an action from the offeror

What does NOT count (exclude unless it demands a vendor action):
- Background, agency overview, general context, definitions, boilerplate with no vendor action

Output format:
Return ONLY valid JSON (no markdown, no commentary). Use exactly this schema:

{
  "sections": [
    {
      "title": "Section Title",
      "description": "Optional section context (short). Empty string if none.",
      "locationHint": "Optional: page/paragraph/heading reference if present; else empty string.",
      "questions": [
        {
          "question": "Exact vendor-facing requirement text (preserve wording).",
          "type": "technical|management|past_performance|pricing|compliance|security|legal|administrative|submission|other",
          "isExplicitQuestion": true,
          "isRequired": "required|optional|unknown",
          "deliverable": "What must be produced (e.g., 'Technical Volume narrative', 'Pricing spreadsheet', 'Resume') or empty string.",
          "responseFormat": "If stated: table/form/narrative/bullets/spreadsheet/upload/portal-entry or empty string.",
          "constraints": ["page limit, font, file type, deadline, naming rules, etc."],
        }
      ]
    }
  ]
}

Rules:
- Preserve the exact wording of each extracted vendor requirement in "question".
- If the document has subsections (e.g., 1.1, L, M, Volume I/II/III), treat each as its own section.
- If a requirement appears in a list/bullets, extract each bullet as a separate question when it implies a separate response/deliverable.
- If a section contains no vendor-facing requirements, include it with "questions": [] only if the section title helps navigation; otherwise omit.
- Ensure the JSON is strictly valid:
  - Use double quotes for all strings
  - No trailing commas
  - No undefined/null (use empty string/[] instead)
- Do NOT invent facts. If required/optional is unclear, set "isRequired":"unknown".
  `.trim();
};

const buildUserPrompt = (content: string) => {
  return `
Extract vendor/offeror response requirements from the following opportunity text.
If the content includes headers like "Instructions to Offerors", "Proposal Submission", "Evaluation Criteria", "Volumes", "Representations and Certifications", "Questions", "Attachments", include all vendor action items and prompts.

Return ONLY JSON that matches the schema from the system message.

DOCUMENT_CONTENT_START
${content}
DOCUMENT_CONTENT_END
  `.trim();
};


export const handler = withSentryLambda(baseHandler);