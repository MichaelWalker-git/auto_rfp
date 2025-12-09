import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import https from 'https';
import { randomUUID } from 'crypto';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { getEmbedding } from '../helpers/embeddings';
import { QUESTION_PK } from '../constants/organization';

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

const bedrockClient = new BedrockRuntimeClient({
  region: REGION,
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;

const BEDROCK_EMBEDDING_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';

const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME env var is not set');
}
if (!DOCUMENTS_BUCKET) {
  throw new Error('DOCUMENTS_BUCKET env var is not set');
}
if (!OPENSEARCH_ENDPOINT) {
  throw new Error('OPENSEARCH_ENDPOINT env var is not set');
}

// --- Types ---
interface AnswerQuestionRequestBody {
  projectId: string;
  questionId?: string;
  question?: string;
  topK?: number;
}

interface OpenSearchHit {
  _source?: {
    documentId?: string;
    text?: string;
    [key: string]: any;
  };

  [key: string]: any;
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
  id?: string;        // your CUID id
  questionText: string;   // the question text
  // you can add answer, sources, etc. here later
  [key: string]: any;
}

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
  });
}

// --- Helper: semantic search in OpenSearch ---
async function semanticSearchDocuments(
  embedding: number[],
  indexName: string,
  k: number,
): Promise<OpenSearchHit[]> {
  const endpointUrl = new URL(OPENSEARCH_ENDPOINT!);
  const payload = JSON.stringify({
    size: k,
    query: {
      knn: {
        embedding: {
          vector: embedding,
          k,
        },
      },
    },
    _source: ['documentId'],
  });

  const request = new HttpRequest({
    method: 'POST',
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: `/${indexName}/_search`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
      host: endpointUrl.hostname,
    },
    body: payload,
  });

  const signer = new SignatureV4({
    service: 'aoss',
    region: REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  const bodyStr = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        method: signed.method,
        hostname: signed.hostname,
        path: signed.path,
        headers: signed.headers as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(text);
          } else {
            reject(
              new Error(
                `OpenSearch search error: ${res.statusCode} ${res.statusMessage} - ${text}`,
              ),
            );
          }
        });
      },
    );

    req.on('error', reject);
    if (signed.body) {
      req.write(signed.body);
    }
    req.end();
  });

  const json = JSON.parse(bodyStr);
  const hits: OpenSearchHit[] = json.hits?.hits ?? [];
  return hits;
}

// --- Helper: find DocumentItem in Dynamo by documentId (PK = DOCUMENT_PK, SK endsWith "#DOC#<id>") ---

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
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': DOCUMENT_PK,
      },
    }),
  );

  const items =
    (queryRes.Items || []) as (DocumentItem & {
      [PK_NAME]: string;
      [SK_NAME]: string;
    })[];

  const docItem = items.find((it) =>
    String(it[SK_NAME]).endsWith(skSuffix),
  );

  if (!docItem) {
    throw new Error(
      `Document not found for PK=${DOCUMENT_PK} and SK ending with ${skSuffix}`,
    );
  }

  return docItem;
}

// --- Helper: load document text from S3 via textFileKey (fallback to fileKey) ---

async function loadDocumentText(docItem: DocumentItem): Promise<string> {
  const textKey = (docItem as any).textFileKey || (docItem as any).fileKey;
  if (!textKey) {
    throw new Error('Document has no textFileKey or fileKey');
  }

  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: textKey,
    }),
  );

  if (!res.Body) {
    throw new Error(`S3 object ${textKey} has no body`);
  }

  const text = await streamToString(res.Body as any);
  return text;
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
    throw new Error(
      `Question not found for PK=${QUESTION_PK}, SK=${questionId}`,
    );
  }

  const item = res.Item as QuestionItemDynamo;

  if (!item.questionText) {
    throw new Error(
      `Question item for SK=${questionId} has no "question" field`,
    );
  }

  return item;
}

async function answerWithBedrockLLM(
  question: string,
  docText: string,
): Promise<Partial<QAItem>> {
  const systemPrompt = `
You are an assistant that answers questions strictly based on the provided document.

Rules:
- If the document does not contain the answer, you MUST set "found" to false and "answer" to an empty string.
- Do NOT invent or guess information that is not clearly supported by the document.
- Do NOT repeat the question in the answer.
- Do NOT begin with, based on ..., just answer.
- Answer concisely, without unnecessary "water" or filler.

Output format:
Return ONLY a single JSON object, no additional text, in this exact shape:

{"answer":"string","confidence":0.0,"found":true}

Where:
- "answer" is the final answer text when found=true, otherwise an empty string "".
- "confidence" is a number between 0.0 and 1.0 that reflects how sure you are based on the document.
- "found" is:
  - true  — when the answer is clearly supported by the document;
  - false — when the answer cannot be found in the document or is too uncertain.
`.trim();

  const userPrompt = [
    'Document:',
    '"""',
    docText,
    '"""',
    '',
    `Question: ${question}`,
  ].join('\n');

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 512,
    temperature: 0.2,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userPrompt }],
      },
    ],
  };

  const res = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID!,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(payload)),
    }),
  );

  if (!res.body) {
    throw new Error('Bedrock (QA) returned no body');
  }

  const raw = Buffer.from(res.body).toString('utf-8');

  console.log('Raw: ', raw)

  let outer: any;
  try {
    outer = JSON.parse(raw);
  } catch (err) {
    console.error('Invalid JSON envelope from Bedrock:', raw);
    throw new Error('Invalid JSON envelope from Bedrock');
  }

  const text: string | undefined = outer?.content?.[0]?.text;
  if (!text) {
    console.error('Unexpected QA response structure:', JSON.stringify(outer).slice(0, 500));
    throw new Error('Model returned no text content');
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model output does not contain a JSON object');
  }

  const slice = text.slice(start, end + 1);

  const parsed = JSON.parse(slice.replace(/\n/g, '\\n'));

  const result: Partial<QAItem> = {
    answer: typeof parsed.answer === 'string' ? parsed.answer : '',
    confidence:
      typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0,
    found: typeof parsed.found === 'boolean' ? parsed.found : false,
  };

  if (!result.found) {
    result.answer = '';
  }

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

  const item: QAItem & {
    [PK_NAME]: string;
    [SK_NAME]: string;
  } = {
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

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

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

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('answer-question event:', JSON.stringify(event));

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is required' });
  }

  let body: AnswerQuestionRequestBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const topK = body.topK && body.topK > 0 ? body.topK : 3;

  let questionText: string | undefined;
  const { questionId, projectId } = body;


  try {
    // 0) Resolve question text:
    //    - If questionId is provided: load from Dynamo
    //    - Else: fallback to raw question text from body
    if (questionId) {
      const questionItem = await getQuestionItemById(projectId, questionId);
      questionText = questionItem.questionText;
      console.log(
        `Loaded question from Dynamo. questionId=${questionId}, question="${questionText}"`,
      );
    } else {
      questionText = body.question?.trim();
      if (!questionText) {
        return apiResponse(400, {
          message:
            'Either questionId (preferred) or question text must be provided',
        });
      }
      // no questionId provided => we will generate one when storing answer
      console.log(
        `Using inline question from request. question="${questionText}"`,
      );
    }

    // 1) Embed question text
    const questionEmbedding = await getEmbedding(
      bedrockClient,
      BEDROCK_EMBEDDING_MODEL_ID,
      questionText,
    );

    // 2) Semantic search in OpenSearch (index "documents")
    const hits = await semanticSearchDocuments(
      questionEmbedding,
      'documents',
      topK,
    );

    console.log('Hits:', JSON.stringify(hits));

    if (!hits.length) {
      return apiResponse(404, {
        message: 'No matching documents found for this question',
      });
    }
    const documentId = hits[0]._source?.documentId || '';

    // 3) Load document metadata from DynamoDB, then text from S3
    const topTexts = await mergeAllTexts("", hits)

    console.log('Question and doc text', questionText, topTexts);

    // 4) Ask Bedrock LLM
    const { answer, confidence, found } = await answerWithBedrockLLM(questionText, topTexts);

    // 5) Store Q&A in Dynamo (re-use questionId if we had one)
    const qaItem = await storeAnswer(
      documentId,
      questionText,
      answer || '',
      confidence || 0,
      found || false,
      questionId,
    );

    // 6) Return response
    return apiResponse(200, {
      documentId,
      questionId: qaItem.questionId,
      answer,
      confidence,
      found,
    });
  } catch (err) {
    console.error('Error in answer-question handler:', err);
    return apiResponse(500, {
      message: 'Failed to answer question',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

const mergeAllTexts = async (acc: string, hits: OpenSearchHit[]): Promise<string> => {
  if (!hits.length) {
    return acc;
  }
  const [first, ...rest] = hits;
  const documentId = first._source?.documentId;
  if (!documentId) {
    return mergeAllTexts(acc, rest);
  }
  const docItem = await getDocumentItemById(documentId);
  const docText = await loadDocumentText(docItem);

  return mergeAllTexts(`${acc}\n${docText}`, rest);
};


function extractValidJson(text: string) {
  // 1. Find JSON boundaries
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error("Model response contains no JSON object");
  }

  // 2. Slice raw JSON
  let jsonSlice = text.slice(start, end + 1);

  // 3. Replace *illegal* bare newlines inside quotes with escaped ones
  jsonSlice = jsonSlice.replace(/"\s*([^"]*?)\n([^"]*?)\s*"/g, (match) => {
    return match.replace(/\n/g, "\\n");
  });

  // 4. Now parse safely
  try {
    return JSON.parse(jsonSlice);
  } catch (err) {
    console.error("Failed JSON:", jsonSlice);
    throw err;
  }
}
