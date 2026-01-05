import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { getEmbedding, OpenSearchHit, semanticSearchChunks } from '../helpers/embeddings';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { AnswerQuestionRequestBody, QAItem } from '@auto-rfp/shared';
import { getQuestionItemById } from '../helpers/question';
import { saveAnswer } from './save-answer';
import { DBItem, docClient } from '../helpers/db';
import { safeParseJsonFromModel } from '../helpers/json';
import { loadTextFromS3 } from '../helpers/s3';


const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

const bedrockClient = new BedrockRuntimeClient({ region: REGION });

export type QuestionItemDynamo = QAItem & DBItem

async function getDocumentItemById(documentId: string): Promise<DocumentItem & DBItem> {
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

async function loadDocumentText(docItem: DocumentItem): Promise<string> {
  const textKey = (docItem as any).textFileKey || (docItem as any).fileKey;
  if (!textKey) throw new Error('Document has no textFileKey or fileKey');
  return loadTextFromS3(DOCUMENTS_BUCKET!, textKey);
}

async function buildContextFromChunkHits(
  hits: OpenSearchHit[],
  opts?: { maxChars?: number },
): Promise<{ context: string; primaryDocumentId: string }> {
  const maxChars = opts?.maxChars ?? 60_000; // keep prompt sane

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
      ? (await loadTextFromS3(DOCUMENTS_BUCKET, src.chunkKey)).trim()
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
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(payload)),
    }),
  );

  if (!res.body) throw new Error('Bedrock (QA) returned no body');

  const raw = Buffer.from(res.body).toString('utf-8');
  console.log('Raw:', raw);

  const parsed = safeParseJsonFromModel(raw);

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

  const { questionId, projectId, question: text } = body;

  try {

    const question = questionId
      ? (await getQuestionItemById(docClient, projectId, questionId)).question
      : text?.trim();

    if (!question) {
      return apiResponse(400, {
        message: 'Either questionId (preferred) or question text must be provided',
      });
    }

    const questionEmbedding = await getEmbedding(question || '',);

    const hits = await semanticSearchChunks(questionEmbedding, topK);
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
    const { answer, confidence, found } = await answerWithBedrockLLM(question, finalContext);

    // 5) Store Q&A in Dynamo
    const qaItem = await saveAnswer({
      documentId: documentId || '',
      questionId: questionId,
      text: answer,
      confidence: confidence,
      source: hits[0]._source?.chunkKey
    });

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

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:generate'))
    .use(httpErrorMiddleware())
);