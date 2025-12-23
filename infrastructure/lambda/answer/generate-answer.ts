import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { getEmbedding, OpenSearchHit, semanticSearchChunks } from '../helpers/embeddings';
import { QUESTION_PK } from '../constants/question';
import { withSentryLambda } from '../sentry-lambda';
import { streamToString } from '../helpers/s3';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

const REGION =
  process.env.REGION ||
  process.env.AWS_REGION ||
  process.env.BEDROCK_REGION ||
  'us-east-1';

const bedrockClient = new BedrockRuntimeClient({ region: REGION });

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX || 'documents';
const BEDROCK_EMBEDDING_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';

const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;

if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET) throw new Error('DOCUMENTS_BUCKET env var is not set');
if (!OPENSEARCH_ENDPOINT) throw new Error('OPENSEARCH_ENDPOINT env var is not set');
if (!BEDROCK_MODEL_ID) throw new Error('BEDROCK_MODEL_ID env var is not set');

// --- Types ---
interface AnswerQuestionRequestBody {
  projectId: string;
  questionId?: string;
  question?: string;
  topK?: number; // how many chunks to retrieve
}

interface QAItem {
  questionId: string;
  documentId: string;
  question: string;
  answer: string;
  createdAt: string;
  confidence: number;
  found: boolean;
}

// Shape of question record in Dynamo (adjust to your actual schema)
interface QuestionItemDynamo {
  [PK_NAME]: string;
  [SK_NAME]: string;
  id?: string;
  questionText: string;

  [key: string]: any;
}

async function loadTextFromS3(bucket: string, key: string): Promise<string> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`S3 object ${key} has no body`);
  return streamToString(res.Body as any);
}

// --- Helper: find DocumentItem in Dynamo by documentId (existing approach kept) ---
async function getDocumentItemById(
  documentId: string,
): Promise<
  DocumentItem & {
  [PK_NAME]: string;
  [SK_NAME]: string;
}
> {
  const skSuffix = `#DOC#${documentId}`;

  const queryRes = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': PK_NAME },
      ExpressionAttributeValues: { ':pk': DOCUMENT_PK },
    }),
  );

  const items =
    (queryRes.Items || []) as (DocumentItem & {
      [PK_NAME]: string;
      [SK_NAME]: string;
    })[];

  const docItem = items.find((it) => String(it[SK_NAME]).endsWith(skSuffix));
  if (!docItem) {
    throw new Error(`Document not found for PK=${DOCUMENT_PK} and SK ending with ${skSuffix}`);
  }
  return docItem;
}

// --- Old fallback (full doc text) ---
async function loadDocumentText(docItem: DocumentItem): Promise<string> {
  const textKey = (docItem as any).textFileKey || (docItem as any).fileKey;
  if (!textKey) throw new Error('Document has no textFileKey or fileKey');
  return loadTextFromS3(DOCUMENTS_BUCKET!, textKey);
}

// --- NEW: build context from chunk hits ---
async function buildContextFromChunkHits(
  hits: OpenSearchHit[],
  opts?: { maxChars?: number },
): Promise<{ context: string; primaryDocumentId: string }> {
  const maxChars = opts?.maxChars ?? 60_000; // keep prompt sane

  // dedupe by chunkKey (OpenSearch can return near-duplicates)
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    const key = h._source?.chunkKey;
    if (!key) return true; // keep, might still have text
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const primaryDocumentId = unique[0]?._source?.documentId || '';

  let acc = '';
  for (const hit of unique) {
    const src = hit._source || {};

    const chunkText = src?.chunkKey
      ? (await loadTextFromS3(DOCUMENTS_BUCKET!, src.chunkKey)).trim()
      : '';

    if (!chunkText) continue;

    const piece = [
      `\n\n---`,
      `documentId: ${src.documentId ?? ''}`,
      src.chunkIndex !== undefined ? `chunkIndex: ${src.chunkIndex}` : undefined,
      src.chunkKey ? `chunkKey: ${src.chunkKey}` : undefined,
      `---\n`,
      chunkText,
    ]
      .filter(Boolean)
      .join('\n');

    if ((acc + piece).length > maxChars) break;
    acc += piece;
  }

  return { context: acc.trim(), primaryDocumentId };
}

// --- Helper: load question by questionId from Dynamo ---
async function getQuestionItemById(
  projectId: string,
  questionId: string,
): Promise<QuestionItemDynamo> {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: `${projectId}#${questionId}`,
      },
    }),
  );

  if (!res.Item) {
    throw new Error(`Question not found for PK=${QUESTION_PK}, SK=${questionId}`);
  }

  const item = res.Item as QuestionItemDynamo;

  if (!item.questionText) {
    throw new Error(`Question item for SK=${questionId} has no "questionText" field`);
  }

  return item;
}

async function answerWithBedrockLLM(question: string, context: string): Promise<Partial<QAItem>> {
  const systemPrompt = `
You are an assistant that answers questions strictly based on the provided context.

Rules:
- If the context does not contain the answer, you MUST set "found" to false and "answer" to an empty string.
- Do NOT invent or guess information that is not clearly supported by the context.
- Do NOT repeat the question in the answer.
- Do NOT begin with "based on...".
- Answer concisely.

Output format:
Return ONLY a single JSON object:

{"answer":"string","confidence":0.0,"found":true}
`.trim();

  const userPrompt = [
    'Context:',
    '"""',
    context,
    '"""',
    '',
    `Question: ${question}`,
  ].join('\n');

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 512,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
  };

  const res = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID!,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(payload)),
    }),
  );

  if (!res.body) throw new Error('Bedrock (QA) returned no body');

  const raw = Buffer.from(res.body).toString('utf-8');
  console.log('Raw:', raw);

  let outer: any;
  try {
    outer = JSON.parse(raw);
  } catch {
    console.error('Invalid JSON envelope from Bedrock:', raw);
    throw new Error('Invalid JSON envelope from Bedrock');
  }

  const text: string | undefined = outer?.content?.[0]?.text;
  if (!text) throw new Error('Model returned no text content');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  const parsed = start === -1 || end === -1 || end <= start
    ? text.trim()
    : JSON.parse(text.slice(start, end + 1).replace(/\n/g, '\\n'));

  const result: Partial<QAItem> = {
    answer: typeof parsed.answer === 'string' ? parsed.answer : '',
    confidence:
      typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0,
    found: typeof parsed.found === 'boolean' ? parsed.found : false,
  };

  if (!result.found) result.answer = '';
  return result;
}

async function storeAnswer(
  documentId: string,
  question: string,
  answer: string,
  confidence: number,
  found: boolean,
  existingQuestionId?: string,
): Promise<QAItem> {
  const now = new Date().toISOString();
  const questionId = existingQuestionId ?? randomUUID();

  const item: QAItem & { [PK_NAME]: string; [SK_NAME]: string } = {
    [PK_NAME]: 'ANSWER',
    [SK_NAME]: `DOC#${documentId}#Q#${questionId}`,
    questionId,
    documentId,
    question,
    answer,
    createdAt: now,
    confidence,
    found,
  };

  await docClient.send(new PutCommand({ TableName: DB_TABLE_NAME, Item: item }));

  return {
    questionId,
    documentId,
    question,
    answer,
    createdAt: now,
    confidence,
    found,
  };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('answer-question event:', JSON.stringify(event));

  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let body: AnswerQuestionRequestBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const topK = body.topK && body.topK > 0 ? body.topK : 30;

  let questionText: string | undefined;
  const { questionId, projectId } = body;

  try {
    // 0) Resolve question text
    if (questionId) {
      const questionItem = await getQuestionItemById(projectId, questionId);
      questionText = questionItem.questionText;
      console.log(`Loaded question from Dynamo. questionId=${questionId}, question="${questionText}"`);
    } else {
      questionText = body.question?.trim();
      if (!questionText) {
        return apiResponse(400, {
          message: 'Either questionId (preferred) or question text must be provided',
        });
      }
      console.log(`Using inline question from request. question="${questionText}"`);
    }

    // 1) Embed question text
    const questionEmbedding = await getEmbedding(
      bedrockClient,
      BEDROCK_EMBEDDING_MODEL_ID,
      questionText,
    );

    // 2) Semantic search in OpenSearch (CHUNKS INDEX)
    const hits = await semanticSearchChunks(
      OPENSEARCH_ENDPOINT,
      questionEmbedding,
      OPENSEARCH_INDEX,
      topK,
      REGION
    );
    console.log('Hits:', JSON.stringify(hits));

    if (!hits.length) {
      return apiResponse(404, { message: 'No matching chunks found for this question' });
    }

    // 3) Build context from chunks (S3 fetches by chunkKey when needed)
    const { context, primaryDocumentId } = await buildContextFromChunkHits(hits, {
      maxChars: 60_000,
    });

    // If for some reason we couldn't build chunk context, fallback to old doc text path
    let finalContext = context;
    let documentId = primaryDocumentId;

    if (!finalContext) {
      // fallback: try to load full doc text from Dynamo + S3
      documentId = hits[0]._source?.documentId || '';
      if (!documentId) throw new Error('No documentId found in top hit');
      const docItem = await getDocumentItemById(documentId);
      finalContext = await loadDocumentText(docItem);
    }

    if (!documentId) documentId = hits[0]._source?.documentId || '';

    // 4) Ask Bedrock LLM
    const { answer, confidence, found } = await answerWithBedrockLLM(questionText, finalContext);

    // 5) Store Q&A in Dynamo
    const qaItem = await storeAnswer(
      documentId,
      questionText,
      answer || '',
      confidence || 0,
      found || false,
      questionId,
    );

    return apiResponse(200, {
      documentId,
      questionId: qaItem.questionId,
      answer,
      confidence,
      found,
      topK
    });
  } catch (err) {
    console.error('Error in answer-question handler:', err);
    return apiResponse(500, {
      message: 'Failed to answer question',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);