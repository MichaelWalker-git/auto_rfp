import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { randomUUID } from 'crypto';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

const BEDROCK_REGION =
  process.env.BEDROCK_REGION ||
  process.env.AWS_REGION ||
  'us-east-1';
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  'anthropic.claude-3-haiku-20240307-v1:0';

const bedrockClient = new BedrockRuntimeClient({
  region: BEDROCK_REGION,
});

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

interface ExtractedQuestion {
  id?: string;
  text: string;
  number?: string;
}

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

  // 2) Call Bedrock to extract questions
  const questions = await extractQuestionsWithClaude(text);

  // 3) Save individual questions in DynamoDB (linked to this file)
  await saveQuestions(questionFileId, projectId, questions);

  // 4) Update status on question_file item
  await updateStatus(questionFileId, projectId, 'questions_extracted');

  return { count: questions.length };
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

async function extractQuestionsWithClaude(
  text: string,
): Promise<ExtractedQuestion[]> {
  const prompt = `
You are an AI assistant that extracts RFP questions from a text document.

The input is the text of an RFP or questionnaire.

Your task:
- Extract a clean list of questions that the vendor must answer.
- Preserve any numbering if present (e.g. "1.1", "Q3", etc).
- Ignore headers, footers, explanatory paragraphs, and instructions that are not actual questions.
- Return ONLY JSON in the following format:

{
  "questions": [
    { "number": "1.1", "text": "Full text of the question ..." },
    { "number": "1.2", "text": "Another question ..." }
  ]
}
`.trim();

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `DOCUMENT TEXT:\n${text}\n\nExtract questions as specified.`,
          },
        ],
      },
    ],
  };

  const res = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    }),
  );

  if (!res.body) {
    throw new Error('Bedrock returned empty body for question extraction');
  }

  const json = JSON.parse(new TextDecoder().decode(res.body));
  console.log(
    'Claude question extraction raw response:',
    JSON.stringify(json).slice(0, 1000),
  );

  // Extract text content
  let textResp = '';
  if (Array.isArray(json.content) && json.content[0]?.text) {
    textResp = json.content[0].text as string;
  } else if (typeof json.output_text === 'string') {
    textResp = json.output_text;
  } else if (typeof json.completion === 'string') {
    textResp = json.completion;
  } else {
    throw new Error('Unexpected Claude question extraction response format');
  }

  // Try to parse JSON from Claude output
  const questions = parseQuestionsJson(textResp);
  return questions;
}

function parseQuestionsJson(text: string): ExtractedQuestion[] {
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct.questions)) return direct.questions;
  } catch {
    // ignore
  }

  // Try ```json blocks
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (match) {
    try {
      const obj = JSON.parse(match[1]);
      if (Array.isArray(obj.questions)) return obj.questions;
    } catch {
      // ignore
    }
  }

  // Fallback: split lines that look like questions (rough)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const guessed: ExtractedQuestion[] = [];
  for (const line of lines) {
    if (line.endsWith('?') || line.toLowerCase().startsWith('q')) {
      guessed.push({ text: line });
    }
  }
  return guessed;
}

/**
 * Save extracted questions as individual items in DynamoDB.
 *
 * PK: QUESTION_FILE_PK (unchanged, as you wanted)
 * SK: `${projectId}#${questionId}`  (current pattern – kept)
 *
 * Stored fields per item:
 * - id
 * - projectId
 * - questionFileId (file this question came from)
 * - text
 * - number
 * - createdAt
 * - updatedAt
 */
async function saveQuestions(
  questionFileId: string,
  projectId: string,
  questions: ExtractedQuestion[],
) {
  const now = new Date().toISOString();

  const writes = questions.map((q, index) => {
    const id = q.id || randomUUID();
    const sk = `${projectId}#${id}`;

    const item = {
      [PK_NAME]: QUESTION_PK,
      [SK_NAME]: sk,
      id,
      projectId,
      questionFileId,
      text: q.text,
      number: q.number ?? null,
      createdAt: now,
      updatedAt: now,
      // you can add extra metadata (order, etc.)
      order: index,
      type: 'QUESTION', // optional discriminator if same PK is used for file + questions
    };

    return docClient.send(
      new PutCommand({
        TableName: DB_TABLE_NAME,
        Item: item,
      }),
    );
  });

  await Promise.all(writes);

  // Optionally, also update the question_file item with questionCount
  const fileSk = `${projectId}#${questionFileId}`;
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: fileSk,
      },
      UpdateExpression:
        'SET #questionCount = :count, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#questionCount': 'questionCount',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':count': questions.length,
        ':updatedAt': now,
      },
    }),
  );
}

async function updateStatus(
  questionFileId: string,
  projectId: string,
  status: 'processing' | 'text_ready' | 'questions_extracted' | 'error',
) {
  const sk = `${projectId}#${questionFileId}`;

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression:
        'SET #status = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': new Date().toISOString(),
      },
    }),
  );
}
