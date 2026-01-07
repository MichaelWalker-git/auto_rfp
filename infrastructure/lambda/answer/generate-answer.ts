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
import { AnswerQuestionRequestBody, AnswerSource, QAItem } from '@auto-rfp/shared';
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

  const items = (queryRes.Items || []) as (DocumentItem & DBItem)[];

  const docItem = items.find((it) => String(it[SK_NAME]).endsWith(skSuffix));
  if (!docItem) {
    throw new Error(`Document not found for PK=${DOCUMENT_PK} and SK ending with ${skSuffix}`);
  }
  return docItem;
}

async function buildContextFromChunkHits(hits: OpenSearchHit[]) {
  const byChunkKey = new Map<string, OpenSearchHit>();

  for (const hit of hits) {
    const k = hit._source?.chunkKey;
    if (!k) continue;
    if (!byChunkKey.has(k)) byChunkKey.set(k, hit);
  }

  const uniqueHits = [...byChunkKey.values()];

  return Promise.all(
    uniqueHits.map(async (hit) => {
      const chunkKey = hit._source?.chunkKey;
      const docId = hit._source?.documentId;
      const text = chunkKey ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey) : '';
      const { name: fileName } = docId ? await getDocumentItemById(docId) : {};
      return { ...hit, text, fileName };
    }),
  );
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

{"answer":"string","confidence":0.0,"found":true, "source": chunkKey}
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
    max_tokens: 2048,
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

  const { questionId, projectId, question: requestQuestion } = body;

  try {

    const question = questionId
      ? (await getQuestionItemById(docClient, projectId, questionId)).question
      : requestQuestion?.trim();

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

    const texts = await buildContextFromChunkHits(hits);

    let finalContext =
      texts.map(h => `${h._source?.chunkKey} content: ${h.text}`).join('\n');

    const { answer, confidence, found, source } = await answerWithBedrockLLM(question, finalContext);

    // 5) Store Q&A in Dynamo
    const qaItem = await saveAnswer({
      questionId: questionId,
      text: answer,
      confidence: confidence,
      sources: texts.map(hit => ({
        id: hit._id,
        documentId: hit._source?.documentId,
        fileName: hit.fileName,
        chunkKey: hit._source?.chunkKey,
        textContent: hit.text,
      } as AnswerSource))
    });

    return apiResponse(200, {
      sources: qaItem.sources,
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