/**
 * Quick diagnostic: what does the retrieval pipeline actually return
 * for a few sample queries? Helps understand why models are refusing.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const ORG_ID = process.env.ORG_ID ?? '';
const PINECONE_API_KEY = process.env.PINECONE_API_KEY ?? '';
const PINECONE_INDEX = process.env.PINECONE_INDEX ?? '';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const DB_TABLE_NAME = process.env.DB_TABLE_NAME ?? '';
const BEDROCK_REGION = process.env.BEDROCK_REGION ?? process.env.REGION ?? 'us-east-1';
const BEDROCK_EMBEDDING_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';

const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: BEDROCK_REGION }));
const s3 = new S3Client({ region: BEDROCK_REGION });

const getEmbedding = async (text: string): Promise<number[]> => {
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: BEDROCK_EMBEDDING_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify({ inputText: text.slice(0, 8000) })),
    }),
  );
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding ?? result.vector;
};

const queries = [
  'Describe your proposed technical approach to meeting the requirements outlined in the solicitation.',
  'Provide three examples of contracts of similar size and scope performed within the last five years.',
  'What certifications does your organization currently hold?',
  'Provide a company overview including legal name and leadership.',
  'Describe your project management methodology and how you will ensure on-time delivery of all milestones.',
];

const main = async () => {
  const index = pc.Index(PINECONE_INDEX);

  for (const query of queries) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`QUERY: ${query}`);
    console.log('='.repeat(100));

    const embedding = await getEmbedding(query);

    for (const type of ['chunk', 'past_project', 'content_library']) {
      const results = await index.namespace(ORG_ID).query({
        vector: embedding,
        topK: 5,
        includeMetadata: true,
        includeValues: false,
        filter: { type: { $eq: type } },
      });

      const matches = results.matches ?? [];
      if (!matches.length) {
        console.log(`\n  [${type}] — NO MATCHES`);
        continue;
      }

      console.log(`\n  [${type}] — ${matches.length} matches:`);
      for (const m of matches) {
        const score = m.score ?? 0;
        const above = score >= 0.20 ? '✓' : '✗';
        const meta = m.metadata ?? {};

        let preview = '';
        if (type === 'chunk') {
          const chunkKey = meta.chunkKey as string | undefined;
          if (chunkKey) {
            try {
              const res = await s3.send(new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: chunkKey }));
              const text = (await res.Body?.transformToString('utf-8')) ?? '';
              preview = text.slice(0, 150).replace(/\n/g, ' ');
            } catch { preview = '[S3 error]'; }
          }
          // Also get doc name
          const pk = meta[PK_NAME] as string | undefined;
          const sk = meta[SK_NAME] as string | undefined;
          if (pk && sk) {
            try {
              const doc = await ddb.send(new GetCommand({ TableName: DB_TABLE_NAME, Key: { [PK_NAME]: pk, [SK_NAME]: sk } }));
              const docName = (doc.Item?.name as string) ?? '';
              if (docName) preview = `[${docName}] ${preview}`;
            } catch {}
          }
        } else if (type === 'past_project') {
          preview = `${meta.title ?? ''} | ${meta.client ?? ''} | ${meta.domain ?? ''}`;
        } else if (type === 'content_library') {
          const pk = meta[PK_NAME] as string | undefined;
          const sk = meta[SK_NAME] as string | undefined;
          if (pk && sk) {
            try {
              const item = await ddb.send(new GetCommand({ TableName: DB_TABLE_NAME, Key: { [PK_NAME]: pk, [SK_NAME]: sk } }));
              preview = `Q: ${(item.Item?.question as string ?? '').slice(0, 120)}`;
            } catch { preview = '[DDB error]'; }
          }
        }

        console.log(`    ${above} score=${score.toFixed(3)} | ${preview.slice(0, 120)}`);
      }
    }
  }
};

main().catch(console.error);
