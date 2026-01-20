import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { invokeModel } from '../helpers/bedrock-http-client';

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
import { AnswerQuestionRequestBody, AnswerSource, QAItem, QuestionItem } from '@auto-rfp/shared';
import { getQuestionItemById } from '../helpers/question';
import { saveAnswer } from './save-answer';
import { DBItem, docClient } from '../helpers/db';
import { safeParseJsonFromModel } from '../helpers/json';
import { loadTextFromS3 } from '../helpers/s3';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

export type QuestionItemDynamo = QuestionItem & DBItem

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
You are an expert proposal writer answering U.S. government RFP/SAM.gov solicitation questions.

You may answer using:
1) The provided context chunks (preferred), AND
2) Common professional knowledge about proposal writing and typical government procurement practices (allowed only when context is missing).

Rules:
- Always return an answer (never leave it blank).
- If the answer is supported by the provided context, set "found" to true and set "source" to the single best chunkKey.
- If the context does NOT contain the needed information, you MUST:
  - set "found" to false
  - set "source" to ""
  - write an answer that is clearly framed as a GENERAL recommendation / template response (not a claim about this specific RFP).
- Never invent RFP-specific facts (deadlines, page limits, required forms, evaluation weights, email addresses, CLIN pricing, security requirements, etc.) unless explicitly present in the context.
- Do not write disclaimers like "based on the context" or "I don’t have enough information". Instead:
  - If found=true: answer directly.
  - If found=false: give a best-practice answer + what to verify in the solicitation.

Output:
Return ONLY valid JSON with exactly these keys (no extra keys, no markdown):

{
  "answer": "string",
  "confidence": 0.0,
  "found": true,
  "source": "chunkKey string",
  "notes": "string"
}

Confidence guidance:
- If grounded=true:
  - 0.85-1.0: explicitly stated in one chunk
  - 0.60-0.84: supported but lightly synthesized within one chunk
- If grounded=false:
  - 0.30-0.59: good general guidance/template
  - 0.00-0.29: question is too RFP-specific to answer; provide a minimal safe template and list exactly what must be verified

Citations:
- When grounded=true, choose ONE best chunkKey for "source".
- When grounded=false, "source" must be "".
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
    max_tokens: 4096,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
  };

  const responseBody = await invokeModel(
    BEDROCK_MODEL_ID,
    JSON.stringify(payload),
    'application/json',
    'application/json'
  );

  const raw = new TextDecoder('utf-8').decode(responseBody);
  console.log('Raw: ', raw);
  let outer: any;
  try {
    outer = JSON.parse(raw);
  } catch {
    console.error('Bad response JSON from Bedrock:', raw);
    throw new Error('Invalid JSON envelope from Bedrock');
  }
  const assistantText = outer?.content?.[0]?.text;
  if (!assistantText) {
    throw new Error('Model returned no text content');
  }
  return safeParseJsonFromModel(assistantText);
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

    const finalContext = texts
      .map(h => `CHUNK_KEY: ${h._source?.chunkKey}\nTEXT:\n${h.text}\n---`)
      .join('\n');

    const { answer, confidence, found, source: _source } = await answerWithBedrockLLM(question, finalContext);

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