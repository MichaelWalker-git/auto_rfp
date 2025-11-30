import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { apiResponse } from '../helpers/api';
import { getEmbedding } from '../helpers/embeddings';

const REGION = process.env.AWS_REGION || 'us-east-1';

// OpenSearch (Serverless) config
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX || 'rfp-rag-index';

// Embedding + QA models
const EMBEDDING_MODEL_ID =
  process.env.BEDROCK_EMBEDDING_MODEL_ID ||
  'amazon.titan-embed-text-v2:0';

const QA_MODEL_ID =
  process.env.BEDROCK_QA_MODEL_ID ||
  'anthropic.claude-3-5-sonnet-20241022-v2:0';

const MAX_TOKENS = Number(process.env.BEDROCK_MAX_TOKENS ?? 1024);
const TEMPERATURE = Number(process.env.BEDROCK_TEMPERATURE ?? 0.2);

if (!OPENSEARCH_ENDPOINT) {
  throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
}

const bedrockClient = new BedrockRuntimeClient({ region: REGION });

// Dev-style OpenSearch client (basic auth optional).
// For IAM-auth, replace with SigV4 signing.
const opensearchClient = new OpenSearchClient({
  node: OPENSEARCH_ENDPOINT,
  auth: process.env.OPENSEARCH_USERNAME
    ? {
      username: process.env.OPENSEARCH_USERNAME,
      password: process.env.OPENSEARCH_PASSWORD || '',
    }
    : undefined,
});

interface RagQuestionRequest {
  question?: string;
  topK?: number;   // optional, default 5
  // Optional future filters:
  // docId?: string;
}

// Main handler: question -> embedding -> vector search -> answer
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    let body: RagQuestionRequest;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const question = body.question?.trim();
    const topK = body.topK && body.topK > 0 ? body.topK : 5;

    if (!question) {
      return apiResponse(400, {
        message: '\'question\' is required in the request body',
      });
    }

    // 1) Get embedding for the question
    const questionEmbedding = await getEmbedding(bedrockClient, EMBEDDING_MODEL_ID, question);

    // 2) Retrieve top chunks from OpenSearch
    const chunks = await retrieveTopChunks(questionEmbedding, topK);

    if (!chunks.length) {
      return apiResponse(200, {
        question,
        answer: 'I couldn\'t find any relevant context in the knowledge base.',
        topChunks: [],
      });
    }

    // 3) Generate answer using Bedrock QA model
    const answer = await generateAnswerFromChunks(question, chunks);

    return apiResponse(200, {
      question,
      answer,
      topChunks: chunks,
    });
  } catch (error) {
    console.error('Error in RAG QA handler:', error);
    return apiResponse(500, {
      message: 'Failed to answer question',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// ---------- Types ----------

interface SearchChunk {
  id: string;
  score: number;
  content: string;
  fileKey?: string;
  txtKey?: string;
  docId?: string;
  chunkIndex?: number;
}


// ---------- Vector search in OpenSearch ----------

async function retrieveTopChunks(
  embedding: number[],
  topK: number,
): Promise<SearchChunk[]> {
  // For better recall, you can set num_candidates > k; here we keep it simple.
  const searchBody: any = {
    size: topK,
    query: {
      knn: {
        embedding: {
          vector: embedding,
          k: topK,
        },
      },
    },
  };

  const resp = await opensearchClient.search({
    index: OPENSEARCH_INDEX,
    body: searchBody,
  });

  const hits = (resp.body as any)?.hits?.hits ?? [];

  const chunks: SearchChunk[] = hits.map((hit: any, i: number) => {
    const source = hit._source || {};
    return {
      id: hit._id ?? `hit_${i}`,
      score: hit._score ?? 0,
      content: source.content ?? '',
      fileKey: source.fileKey,
      txtKey: source.txtKey,
      docId: source.docId,
      chunkIndex: source.chunkIndex,
    };
  });

  return chunks;
}

// ---------- Answer generation with Bedrock QA model ----------

async function generateAnswerFromChunks(
  question: string,
  chunks: SearchChunk[],
): Promise<string> {
  const context = buildContextFromChunks(chunks);

  const systemPrompt = `
You are an expert assistant helping answer questions based on provided context from RFP and related documents.

You MUST:
- Only use the provided context to answer.
- If the context does not contain the answer, say you don't know.
- Be concise but clear.
- When appropriate, refer to which part of the context you used (e.g. "Based on chunk 2...").
`.trim();

  const userPrompt = `
Question:
${question}

Context:
${context}

Using ONLY the context above, answer the question. If you cannot answer from the context, say you don't know.
`.trim();

  const body = {
    messages: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: systemPrompt,
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  };

  const command = new InvokeModelCommand({
    modelId: QA_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response body from QA model');
  }

  const responseString = new TextDecoder('utf-8').decode(
    response.body as Uint8Array,
  );

  let outer: any;
  try {
    outer = JSON.parse(responseString);
  } catch (err) {
    console.error('QA model raw response:', responseString);
    throw new Error('Invalid JSON from QA model');
  }

  const assistantText: string | null =
    outer?.content?.[0]?.text ??
    outer?.output_text ??
    null;

  if (!assistantText || typeof assistantText !== 'string') {
    console.error('Unexpected QA model payload:', outer);
    throw new Error('Empty response from QA model');
  }

  return assistantText.trim();
}

function buildContextFromChunks(chunks: SearchChunk[]): string {
  return chunks
    .map((c, idx) => {
      const headerParts = [
        `Chunk ${idx + 1}`,
        c.docId ? `docId=${c.docId}` : null,
        c.chunkIndex !== undefined ? `chunkIndex=${c.chunkIndex}` : null,
        c.score !== undefined ? `score=${c.score.toFixed(3)}` : null,
      ].filter(Boolean);

      const header = headerParts.join(' | ');

      return `${header}\n${c.content}`;
    })
    .join('\n\n---\n\n');
}
