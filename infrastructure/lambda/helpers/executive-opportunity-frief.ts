import crypto from 'crypto';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';


import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';

import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, QuestionFileItem, SectionStatus, } from '@auto-rfp/shared';
import { requireEnv } from './env';
import { docClient } from './db';
import { nowIso } from './date';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

export type SchemaLike<T = unknown> = {
  parse: (data: unknown) => T;
};

export type BriefSectionName =
  | 'summary'
  | 'deadlines'
  | 'requirements'
  | 'contacts'
  | 'risks'
  | 'scoring';

export function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Keep prompts within safe limits (you can tune this).
 * For Bedrock, request limits vary by model; this is a practical guard.
 */
export function truncateText(text: string, maxChars: number) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[TRUNCATED]';
}

/**
 * Extract JSON even if the model wraps it in text or ```json fences.
 */
export function extractFirstJsonObject(text: string): string {
  if (!text) throw new Error('Empty model output');

  // Remove ```json fences if present
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();

  // Try direct parse first
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // continue
  }

  // Find first { ... } block via a simple brace scan
  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('No JSON object start "{" found in model output');

  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) {
      const jsonStr = candidate.slice(start, i + 1);
      JSON.parse(jsonStr); // validate
      return jsonStr;
    }
  }
  throw new Error('No complete JSON object found in model output');
}

export function safeJsonParse<T>(text: string, schema: SchemaLike<T>): T {
  const jsonStr = extractFirstJsonObject(text);
  const parsed = JSON.parse(jsonStr);
  return schema.parse(parsed);
}

// -------------------------
// S3 helpers
// -------------------------
async function streamToString(body: any): Promise<string> {
  if (!body) return '';
  // In AWS SDK v3, body is a readable stream in Node runtimes
  const chunks: Buffer[] = [];
  for await (const chunk of body as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function loadTextFromS3(bucket: string, key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return streamToString(res.Body);
}

/**
 * Finds latest QuestionFile for project by createdAt.
 * NOTE: This works only if you can query items for projectId efficiently.
 * Because your SK begins with `${projectId}#`, this Query uses begins_with on SK
 * (still partitioned by QUESTION_FILE_PK).
 */
export async function loadLatestQuestionFile(projectId: string): Promise<QuestionFileItem> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_FILE_PK,
          ':skPrefix': `${projectId}#`,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items?.length) items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (!items.length) {
    throw new Error(`No QuestionFiles found for projectId=${projectId}`);
  }

  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

// -------------------------
// ExecutiveBrief helpers
// -------------------------
export async function getExecutiveBrief(executiveBriefId: string): Promise<ExecutiveBriefItem> {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: EXEC_BRIEF_PK,
        [SK_NAME]: executiveBriefId,
      },
    }),
  );

  if (!res.Item) throw new Error(`ExecutiveBrief not found: ${executiveBriefId}`);
  return ExecutiveBriefItemSchema.parse(res.Item);
}

export async function putExecutiveBrief(item: ExecutiveBriefItem): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
    }),
  );
}

export async function markSectionInProgress(args: {
  executiveBriefId: string;
  section: BriefSectionName;
  inputHash?: string;
}): Promise<void> {
  const { executiveBriefId, section, inputHash } = args;
  const now = nowIso();

  const updateExprParts = [
    'SET #sections.#sec.#status = :status',
    '#sections.#sec.#updatedAt = :now',
    'updatedAt = :now',
  ];
  const names: Record<string, string> = {
    '#sections': 'sections',
    '#sec': section,
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, any> = {
    ':status': 'IN_PROGRESS',
    ':now': now,
  };

  if (inputHash) {
    updateExprParts.push('#sections.#sec.#inputHash = :h');
    names['#inputHash'] = 'inputHash';
    values[':h'] = inputHash;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: EXEC_BRIEF_PK,
        [SK_NAME]: executiveBriefId
      },
      UpdateExpression: updateExprParts.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function markSectionComplete<T>(args: {
  executiveBriefId: string;
  section: BriefSectionName;
  data: T;
  topLevelPatch?: Partial<
    Pick<ExecutiveBriefItem, 'compositeScore' | 'recommendation' | 'confidence' | 'status'>
  >;
}): Promise<void> {
  const { executiveBriefId, section, data, topLevelPatch } = args;
  const now = nowIso();

  const names: Record<string, string> = {
    '#sections': 'sections',
    '#sec': section,
    '#status': 'status',
    '#updatedAt': 'updatedAt',
    '#data': 'data',
    '#error': 'error',
  };

  const values: Record<string, any> = {
    ':status': 'COMPLETE',
    ':now': now,
    ':data': data,
  };

  const setParts: string[] = [
    '#sections.#sec.#status = :status',
    '#sections.#sec.#updatedAt = :now',
    '#sections.#sec.#data = :data',
    'updatedAt = :now',
  ];

  const removeParts: string[] = [
    '#sections.#sec.#error',
  ];

  if (topLevelPatch) {
    if (topLevelPatch.compositeScore !== undefined) {
      setParts.push('compositeScore = :cs');
      values[':cs'] = topLevelPatch.compositeScore;
    }
    if (topLevelPatch.recommendation !== undefined) {
      setParts.push('recommendation = :rec');
      values[':rec'] = topLevelPatch.recommendation;
    }
    if (topLevelPatch.confidence !== undefined) {
      setParts.push('confidence = :conf');
      values[':conf'] = topLevelPatch.confidence;
    }
    if (topLevelPatch.status !== undefined) {
      // uses same top-level attr "status"
      setParts.push('#briefStatus = :bs');
      names['#briefStatus'] = 'status';
      values[':bs'] = topLevelPatch.status;
    }
  }

  const updateExpression =
    `SET ${setParts.join(', ')}` + (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: EXEC_BRIEF_PK, [SK_NAME]: executiveBriefId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function markSectionFailed(args: {
  executiveBriefId: string;
  section: BriefSectionName;
  error: unknown;
}): Promise<void> {
  const { executiveBriefId, section, error } = args;
  const now = nowIso();
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : 'Unknown error';

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: EXEC_BRIEF_PK,
        [SK_NAME]: executiveBriefId
      },
      UpdateExpression:
        'SET #sections.#sec.#status = :status, #sections.#sec.#updatedAt = :now, #sections.#sec.#error = :err, updatedAt = :now',
      ExpressionAttributeNames: {
        '#sections': 'sections',
        '#sec': section,
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#error': 'error',
      },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':now': now,
        ':err': message,
      },
    }),
  );
}

/**
 * Optionally compute an overall status from sections.
 * You can call this after each section completes, or only in scoring.
 */
export function computeOverallStatus(
  sections: Record<string, { status: SectionStatus }>,
): SectionStatus {
  const statuses = Object.values(sections).map((s) => s.status);

  if (statuses.some((s) => s === 'FAILED')) return 'FAILED';
  if (statuses.every((s) => s === 'COMPLETE')) return 'COMPLETE';
  if (statuses.some((s) => s === 'IN_PROGRESS')) return 'IN_PROGRESS';
  return 'IDLE';
}

// -------------------------
// Knowledge base helpers (stub)
// -------------------------
export type KnowledgeBaseMatch = {
  chunkKey: string;
  score: number;
  text?: string; // if you fetch from S3
  documentId?: string;
};

export async function queryCompanyKnowledgeBase(_args: {
  solicitationText: string;
  topK?: number;
}): Promise<KnowledgeBaseMatch[]> {
  // TODO: Replace with your vector search logic:
  // 1) embed solicitationText (or key sections)
  // 2) query your KB index/table for topK chunks
  // 3) fetch chunk text from S3 by chunkKey
  return [];
}

// -------------------------
// Claude / Bedrock helpers
// -------------------------
export async function invokeClaudeJson<S extends SchemaLike<any>>(args: {
  modelId: string;
  system: string;
  user: string;
  outputSchema: S;
  maxTokens?: number;
  temperature?: number;
}): Promise<ReturnType<S['parse']>> {
  const {
    modelId,
    system,
    user,
    outputSchema,
    maxTokens = 2000,
    temperature = 0.2,
  } = args;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
  };

  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }),
  );

  if (!res.body) throw new Error('Empty response body from Claude model');

  const text = new TextDecoder('utf-8').decode(res.body as Uint8Array);

  let rawOutput = text;
  try {
    const json = JSON.parse(text);
    const contentText =
      json?.content?.map((c: any) => c?.text).filter(Boolean).join('\n') ??
      json?.output_text ??
      json?.completion ??
      null;
    if (contentText) rawOutput = contentText;
  } catch {
    // keep rawOutput
  }

  try {
    return safeJsonParse(rawOutput, outputSchema);
  } catch (e) {
    console.error('Claude raw output:', rawOutput);
    throw e;
  }
}


// -------------------------
// High-level loader (used by each section)
// -------------------------
export async function loadSolicitationForBrief(brief: ExecutiveBriefItem): Promise<{
  solicitationText: string;
}> {
  const solicitationText = await loadTextFromS3(
    brief.documentsBucket || DOCUMENTS_BUCKET,
    brief.textKey,
  );

  if (!solicitationText || solicitationText.trim().length < 20) {
    throw new Error('Solicitation text is empty or too short');
  }

  return { solicitationText };
}

/**
 * Build a stable idempotency hash per section.
 * Use questionFileId + textKey + sectionName to detect reruns.
 */
export function buildSectionInputHash(args: {
  executiveBriefId: string;
  section: BriefSectionName;
  questionFileId: string;
  textKey: string;
}): string {
  const { executiveBriefId, section, questionFileId, textKey } = args;
  return sha256(`${executiveBriefId}:${section}:${questionFileId}:${textKey}`);
}