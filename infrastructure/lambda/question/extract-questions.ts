import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import { DynamoDBClient, } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/organization';

const REGION =
  process.env.AWS_REGION ||
  process.env.BEDROCK_REGION ||
  'us-east-1';

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

const MAX_TOKENS = Number(process.env.BEDROCK_MAX_TOKENS ?? 4000);
const TEMPERATURE = Number(process.env.BEDROCK_TEMPERATURE ?? 0.1);

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}

const bedrockClient = new BedrockRuntimeClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

interface ExtractQuestionsRequestBody {
  s3Key: string;
  s3Bucket?: string;  // optional – falls back to DOCUMENTS_BUCKET
  projectId: string;  // REQUIRED for saving questions
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

const DEFAULT_BUCKET = process.env.DOCUMENTS_BUCKET;

async function getObjectAsString(bucket: string, key: string): Promise<string> {
  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  if (!res.Body) {
    throw new Error('Empty S3 object body');
  }

  const body: any = res.Body;

  if (typeof body.transformToString === 'function') {
    return await body.transformToString();
  }

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('error', reject);
    body.on('end', () =>
      resolve(Buffer.concat(chunks).toString('utf-8')),
    );
  });
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, {
        message: 'Request body is required',
      });
    }

    // Handle potential base64-encoded body
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    let body: ExtractQuestionsRequestBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiResponse(400, {
        message: 'Invalid JSON in request body',
      });
    }

    const { s3Key, s3Bucket, projectId } = body;

    if (!projectId) {
      return apiResponse(400, {
        message: '\'projectId\' is required in the request body',
      });
    }

    const bucketToUse = s3Bucket || DEFAULT_BUCKET;
    if (!bucketToUse) {
      return apiResponse(400, {
        message:
          '\'s3Bucket\' is required in body or DOCUMENTS_BUCKET env var must be set',
      });
    }

    let sourceContent: string | undefined;

    try {
      sourceContent = await getObjectAsString(bucketToUse, s3Key);
    } catch (err) {
      console.error(
        `Failed to read S3 object ${bucketToUse}/${s3Key}:`,
        err,
      );
      return apiResponse(500, {
        message: 'Failed to read document from S3',
      });
    }

    if (!sourceContent) {
      return apiResponse(400, {
        message: 'Document content is empty',
      });
    }

    const extracted = await extractQuestionsWithBedrock(sourceContent);

    // === Save questions into DynamoDB in the context of the project ===
    await saveQuestionsToDynamo(projectId, extracted);

    // Return sections back to the caller
    return apiResponse(200, {
      sections: extracted.sections ?? [],
    });
  } catch (error) {
    console.error('Error in extract-questions handler:', error);
    return apiResponse(500, {
      message: 'Failed to extract questions',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

async function extractQuestionsWithBedrock(
  content: string,
): Promise<ExtractedQuestions> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(content);

  const body = {
    anthropic_version: "bedrock-2023-05-31",   // REQUIRED
    system: systemPrompt,                      // <-- TOP LEVEL SYSTEM
    messages: [
      {
        role: "user",                          // ONLY user or assistant allowed
        content: userPrompt,
      },
    ],
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const response = await bedrockClient.send(command);

  if (!response.body) throw new Error("Empty response body from Bedrock");

  const jsonTxt = new TextDecoder("utf-8").decode(response.body);

  let outer;
  try {
    outer = JSON.parse(jsonTxt);
  } catch {
    console.error("Bad response JSON:", jsonTxt);
    throw new Error("Invalid JSON envelope from Bedrock");
  }

  const assistantText = outer?.content?.[0]?.text;
  if (!assistantText)
    throw new Error("Model returned no text");

  let parsed;
  try {
    parsed = JSON.parse(assistantText);
  } catch (err) {
    console.error("Model output was not JSON:", assistantText);
    throw new Error("Invalid JSON returned by the model");
  }

  if (!Array.isArray(parsed.sections))
    throw new Error("Response missing required sections[]");

  return parsed as ExtractedQuestions;
}


/**
 * Save all extracted questions for a given projectId into DynamoDB.
 * PK = QUESTION_PK (e.g. "QUESTION")
 * SK = `${projectId}#${questionId}`
 */
async function saveQuestionsToDynamo(
  projectId: string,
  extracted: ExtractedQuestions,
): Promise<void> {
  const now = new Date().toISOString();

  for (const section of extracted.sections) {
    for (const q of section.questions) {
      const sortKey = `${projectId}#${q.id}`;

      const item = {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: sortKey,
        projectId,
        questionId: q.id,
        questionText: q.question,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionDescription: section.description ?? null,
        createdAt: now,
        updatedAt: now,
      };

      await docClient.send(
        new PutCommand({
          TableName: DB_TABLE_NAME,
          Item: item,
        }),
      );
    }
  }
}

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
