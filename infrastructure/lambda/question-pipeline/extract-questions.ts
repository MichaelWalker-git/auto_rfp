import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { invokeModel } from '../helpers/bedrock-http-client';

import { QUESTION_PK } from '../constants/organization';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME;

if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET_NAME)
  throw new Error('DOCUMENTS_BUCKET_NAME env var is not set');

interface Event {
  questionFileId?: string;
  projectId?: string;
  textFileKey?: string;
}

type ExtractedQuestions = {
  sections: Array<{
    id: string;
    title: string;
    description?: string | null;
    questions: Array<{
      id: string;
      question: string;
    }>;
  }>;
};

export const handler = async (
  event: Event,
  _ctx: Context,
): Promise<{ count: number }> => {
  console.log('extract-questions event:', JSON.stringify(event));

  const { questionFileId, projectId, textFileKey } = event;
  if (!questionFileId || !projectId || !textFileKey) {
    throw new Error('questionFileId, projectId, textFileKey are required');
  }

  // 1) Load text from S3
  const text = await loadTextFromS3(textFileKey);

  // 2) Call Bedrock with the same prompt/structure as in the HTTP Lambda
  const extracted = await extractQuestionsWithBedrock(text);

  // 3) Save questions (section + questions) in DynamoDB (linked to this file)
  const totalQuestions = await saveQuestionsFromSections(
    questionFileId,
    projectId,
    extracted,
  );

  // 4) Update status on question_file item
  await updateStatus(questionFileId, projectId, 'questions_extracted', totalQuestions);

  return { count: totalQuestions };
};

async function loadTextFromS3(key: string): Promise<string> {
  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET_NAME,
      Key: key,
    }),
  );

  const body = await res.Body?.transformToString();
  if (!body) {
    throw new Error(`Failed to read text file from S3: ${key}`);
  }
  return body;
}

async function extractQuestionsWithBedrock(
  content: string,
): Promise<ExtractedQuestions> {
  const systemPrompt = buildSystemPrompt();
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
    max_tokens: 2048,
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

  const assistantText = outer?.content?.[0]?.text;
  if (!assistantText) {
    throw new Error('Model returned no text content');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(assistantText);
  } catch (err) {
    console.error('Model output was not JSON:', assistantText);
    throw new Error('Invalid JSON returned by the model');
  }

  if (!Array.isArray(parsed.sections)) {
    throw new Error('Response missing required sections[]');
  }

  return parsed as ExtractedQuestions;
}

/**
 * Save all extracted sections + questions for a given project and questionFileId.
 *
 * PK = QUESTION_PK
 * SK = `${projectId}#${questionId}`
 *
 * Дополнительно привязываем к questionFileId и сохраняем section-метаданные.
 */
async function saveQuestionsFromSections(
  questionFileId: string,
  projectId: string,
  extracted: ExtractedQuestions,
): Promise<number> {
  const now = new Date().toISOString();
  let count = 0;

  const writes: Promise<any>[] = [];

  for (const section of extracted.sections) {
    for (const q of section.questions) {
      const sortKey = `${projectId}#${q.id}`;

      const item = {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: sortKey,
        projectId,
        questionFileId,
        questionId: q.id,
        questionText: q.question,
        sectionId: section.id,
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

async function updateStatus(
  questionFileId: string,
  projectId: string,
  status: 'processing' | 'text_ready' | 'questions_extracted' | 'error',
  questionCount?: number,
) {
  const sk = `${projectId}#${questionFileId}`;

  const updateParts: string[] = ['#status = :status', '#updatedAt = :updatedAt'];
  const exprAttrNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const exprAttrValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (typeof questionCount === 'number') {
    updateParts.push('#questionCount = :questionCount');
    exprAttrNames['#questionCount'] = 'questionCount';
    exprAttrValues[':questionCount'] = questionCount;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    }),
  );
}

/**
 * Копия buildSystemPrompt из второй лямбды
 */
function buildSystemPrompt(): string {
  const timestamp = Date.now();
  return `
You are an expert at analyzing RFP (Request for Proposal) documents and extracting structured information.
Given a document that contains RFP questions, extract all sections and questions into a structured format.

Carefully identify:
1. Different sections (usually numbered like 1.1, 1.2, etc.)
2. The questions within each section
3. Any descriptive text that provides context for the section

Format the output as a JSON object with the following structure:
{
  "sections": [
    {
      "id": "section_${timestamp}_1",
      "title": "Section Title",
      "description": "Optional description text for the section",
      "questions": [
        {
          "id": "q_${timestamp}_1_1",
          "question": "The exact text of the question"
        }
      ]
    }
  ]
}

Requirements:
- Generate unique reference IDs using the format: q_${timestamp}_<section>_<question> for questions
- Generate unique reference IDs using the format: section_${timestamp}_<number> for sections  
- Preserve the exact text of questions
- Include all questions found in the document
- Group questions correctly under their sections
- If a section has subsections, create separate sections for each subsection
- The timestamp prefix (${timestamp}) ensures uniqueness across different document uploads

Return ONLY the JSON object, with no additional text.
  `.trim();
}

function buildUserPrompt(content: string): string {
  return `Document Content:\n${content}`;
}