import { Context } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { QUESTION_PK } from '@/constants/question';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { safeParseJsonFromModel } from '@/helpers/json';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import { loadTextFromS3 } from '@/helpers/s3';
import { v4 as uuidv4 } from 'uuid';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { GroupedSection } from '@auto-rfp/core';
import { buildQuestionSK, isConditionalCheckFailed, normalizeQuestionText, sha256Hex } from '@/helpers/question';

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const MAX_CHARS_PER_CHUNK = 30000; // ~7500 tokens 
const CHUNK_OVERLAP = 500; // Overlap to avoid cutting mid-sentence

export interface ExtractQuestionsEvent {
  questionFileId: string;
  projectId: string;
  textFileKey: string;
  opportunityId: string;
}

type ExtractedQuestions = { sections: GroupedSection[] }

function splitTextIntoChunks(
  text: string,
  maxChars: number,
  overlap: number
): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    // If not the last chunk, try to break at a sentence or paragraph
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
}

export const baseHandler = async (
  event: ExtractQuestionsEvent,
  _ctx: Context,
): Promise<{ count: number, cancelled: boolean }> => {
  console.log('extract-questions event:', JSON.stringify(event));

  const { questionFileId, projectId, textFileKey, opportunityId } = event;
  if (projectId && opportunityId && questionFileId) {
    const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
    if (isCancelled) {
      console.log(`Pipeline cancelled for ${questionFileId}, skipping processing`);
      return {
        count: 0,
        cancelled: true,
      };
    }
  }

  // Validate required fields with specific error messages (AUTO-RFP-4P)
  const missingFields: string[] = [];
  if (!projectId) missingFields.push('projectId');
  if (!questionFileId) missingFields.push('questionFileId');
  if (!textFileKey) missingFields.push('textFileKey');
  if (!opportunityId) missingFields.push('opportunityId');

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required fields: ${missingFields.join(', ')}. ` +
      `Received: projectId=${projectId ?? 'undefined'}, questionFileId=${questionFileId ?? 'undefined'}, ` +
      `textFileKey=${textFileKey ?? 'undefined'}, opportunityId=${opportunityId ?? 'undefined'}`
    );
  }
  const text = await loadTextFromS3(DOCUMENTS_BUCKET, textFileKey);
  console.log(`Loaded text: ${text.length} characters`);

  const chunks = splitTextIntoChunks(text, MAX_CHARS_PER_CHUNK, CHUNK_OVERLAP);
  console.log(`Split into ${chunks.length} chunks`);

  const allSections: GroupedSection[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length}`);

    try {
      const extracted = await extractQuestionsWithBedrock(chunks[i]!, i, chunks.length); // Safe: iterating within bounds
      allSections.push(...extracted.sections);

      console.log(`Chunk ${i + 1} extracted ${extracted.sections.length} sections`);
    } catch (err: unknown) {
      console.error(`Failed to extract from chunk ${i + 1}:`, err);
    }
  }

  const mergedSections = mergeSections(allSections);
  console.log(`After merging: ${mergedSections.length} sections`);

  const totalQuestions = await saveQuestionsFromSections(
    questionFileId,
    projectId,
    opportunityId,
    { sections: mergedSections },
  );

  await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'PROCESSED', totalQuestions });

  return { count: totalQuestions, cancelled: false };
};

async function extractQuestionsWithBedrock(
  content: string,
  chunkIndex: number,
  totalChunks: number
): Promise<ExtractedQuestions> {
  const systemPrompt = getSystemPrompt();
  const userPrompt = buildUserPrompt(content, chunkIndex, totalChunks);

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

  const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(body));

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

  if (stopReason === 'max_tokens') {
    console.warn('Response was truncated - consider smaller chunks');
  }

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

function mergeSections(sections: GroupedSection[]): GroupedSection[] {
  const sectionMap = new Map<string, GroupedSection>();

  for (const section of sections) {
    const key = section.title.toLowerCase().trim();

    if (sectionMap.has(key)) {
      const existing = sectionMap.get(key)!;
      existing.questions.push(...section.questions);
    } else {
      sectionMap.set(key, { ...section });
    }
  }

  const merged = Array.from(sectionMap.values());

  for (const section of merged) {
    section.questions = deduplicateQuestions(section.questions);
  }

  return merged;
}

function deduplicateQuestions(questions: any[]): any[] {
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const q of questions) {
    const normalized = q.question.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(q);
    }
  }

  return unique;
}

async function saveQuestionsFromSections(
  questionFileId: string,
  projectId: string,
  opportunityId: string,
  extracted: ExtractedQuestions,
): Promise<number> {
  const now = nowIso();

  const seenInThisRun = new Set<string>();

  let inserted = 0;
  let skippedDuplicates = 0;

  const writes: Promise<void>[] = [];

  for (const section of extracted.sections) {
    const sectionId = uuidv4();

    for (const q of section.questions) {
      const rawQuestion = q?.question;
      if (!rawQuestion) continue;

      const normalized = normalizeQuestionText(rawQuestion);
      if (!normalized) continue;

      if (seenInThisRun.has(normalized)) {
        skippedDuplicates++;
        continue;
      }
      seenInThisRun.add(normalized);

      const questionHash = sha256Hex(normalized);

      const questionId = questionHash;

      const sortKey = buildQuestionSK(projectId, questionHash);

      const item = {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: sortKey,

        projectId,
        opportunityId,
        questionFileId,

        questionId,
        question: String(rawQuestion).trim(),

        sectionId,
        sectionTitle: section.title,
        sectionDescription: section.description ?? null,

        questionHash,
        questionNormalized: normalized,

        createdAt: now,
        updatedAt: now,
      };

      writes.push(
        docClient
          .send(
            new PutCommand({
              TableName: DB_TABLE_NAME,
              Item: item,
              ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
              ExpressionAttributeNames: {
                '#pk': PK_NAME,
                '#sk': SK_NAME,
              },
            }),
          )
          .then(() => {
            inserted++;
          })
          .catch((err: unknown) => {
            if (isConditionalCheckFailed(err)) {
              skippedDuplicates++;
              return;
            }
            throw err;
          }),
      );
    }
  }

  await Promise.all(writes);

  console.log(`Questions write result: inserted=${inserted}, skippedDuplicates=${skippedDuplicates}`);

  return inserted;
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

const buildUserPrompt = (content: string, chunkIndex: number, totalChunks: number) => {
  const chunkInfo = totalChunks > 1
    ? `\n\nNOTE: This is chunk ${chunkIndex + 1} of ${totalChunks}. Extract questions from this portion only.`
    : '';
  return `
Extract vendor/offeror response requirements from the following opportunity text.
If the content includes headers like "Instructions to Offerors", "Proposal Submission", "Evaluation Criteria", "Volumes", "Representations and Certifications", "Questions", "Attachments", include all vendor action items and prompts.

Return ONLY JSON that matches the schema from the system message.${chunkInfo}

DOCUMENT_CONTENT_START
${content}
DOCUMENT_CONTENT_END
  `.trim();
};


export const handler = withSentryLambda(baseHandler);