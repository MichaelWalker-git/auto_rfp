import crypto from 'crypto';
import { PutCommand, QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';

import { type ExecutiveBriefItem, QuestionFileItem, SectionStatus, } from '@auto-rfp/core';
import { requireEnv } from './env';
import { docClient, getItem } from './db';
import { nowIso } from './date';
import { loadTextFromS3 } from './s3';
import { getEmbedding, semanticSearchChunks } from './embeddings';
import { invokeModel } from './bedrock-http-client';
import { PineconeHit } from './pinecone';

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
  | 'pastPerformance'
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
 * Extract JSON object or array even if the model wraps it in text or ```json fences.
 * Fixes AUTO-RFP-67 and AUTO-RFP-5D: Better error handling for truncated/malformed responses.
 * Supports both JSON objects {...} and arrays [...].
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
    // continue to bracket scanning
  }

  // Find first { or [ to support both objects and arrays
  const objectStart = candidate.indexOf('{');
  const arrayStart = candidate.indexOf('[');
  
  // Determine which comes first (or if neither exists)
  let start: number;
  let openBracket: string;
  let closeBracket: string;
  
  if (objectStart === -1 && arrayStart === -1) {
    const preview = candidate.length > 200 ? candidate.slice(0, 200) + '...' : candidate;
    throw new Error(`No JSON start "{" or "[" found in model output. Received: ${preview}`);
  } else if (objectStart === -1) {
    start = arrayStart;
    openBracket = '[';
    closeBracket = ']';
  } else if (arrayStart === -1) {
    start = objectStart;
    openBracket = '{';
    closeBracket = '}';
  } else {
    // Both exist - use whichever comes first
    if (arrayStart < objectStart) {
      start = arrayStart;
      openBracket = '[';
      closeBracket = ']';
    } else {
      start = objectStart;
      openBracket = '{';
      closeBracket = '}';
    }
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];

    // Handle string escaping properly
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }

    // Only count brackets outside of strings
    // Track both {} and [] for nested structures
    if (!inString) {
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (depth === 0) {
        const jsonStr = candidate.slice(start, i + 1);
        try {
          JSON.parse(jsonStr); // validate
          return jsonStr;
        } catch (parseErr) {
          // Fix AUTO-RFP-67: Better error context for JSON parse failures
          const errorMsg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error';
          throw new Error(`JSON SyntaxError parsing extracted JSON: ${errorMsg}. JSON length: ${jsonStr.length}`);
        }
      }
    }
  }

  // Fix AUTO-RFP-5D: Better error message for truncated responses
  const truncatedPreview = candidate.length > 300 ? candidate.slice(-300) : candidate;
  throw new Error(
    `No complete JSON found in model output. Response may be truncated. ` +
    `Depth at end: ${depth}, in string: ${inString}. End of response: ...${truncatedPreview}`
  );
}

export function safeJsonParse<T>(text: string, schema: SchemaLike<T>): T {
  const jsonStr = extractFirstJsonObject(text);
  const parsed = JSON.parse(jsonStr);
  return schema.parse(parsed);
}

/**
 * Finds latest QuestionFile for project (and optionally opportunity) by createdAt.
 * NOTE: This works only if you can query items for projectId efficiently.
 * Because your SK begins with `${projectId}#`, this Query uses begins_with on SK
 * (still partitioned by QUESTION_FILE_PK).
 *
 * @param projectId - The project ID
 * @param opportunityId - Optional opportunity ID to filter by
 */
/**
 * Load ALL question files for a project (and optionally opportunity).
 * Returns all non-deleted files sorted by createdAt descending.
 */
export async function loadAllQuestionFiles(projectId: string, opportunityId: string): Promise<QuestionFileItem[]> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  const skPrefix = `${projectId}#${opportunityId}#`

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': QUESTION_FILE_PK, ':skPrefix': skPrefix },
        ExclusiveStartKey,
      }),
    );
    if (res.Items?.length) items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items
    .filter((item: any) => item.status !== 'DELETED' && item.fileKey)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Load ALL solicitation texts for a project+opportunity by reading all question files from S3.
 * Returns the merged text from all files, separated by document markers.
 */
export async function loadAllSolicitationTexts(
  projectId: string,
  opportunityId: string,
  maxChars?: number,
): Promise<string> {
  const files = await loadAllQuestionFiles(projectId, opportunityId);

  if (!files.length) {
    console.warn(`No question files found for projectId=${projectId}, opportunityId=${opportunityId}`);
    return '';
  }

  const textPromises = files.map(async (file: any) => {
    try {
      const text = await loadTextFromS3(DOCUMENTS_BUCKET, file.fileKey);
      return { fileName: file.originalFileName || file.fileKey, text, success: true };
    } catch (err) {
      console.warn(`Failed to load text from ${file.fileKey}:`, (err as Error)?.message);
      return { fileName: file.fileKey, text: '', success: false };
    }
  });

  const results = await Promise.all(textPromises);
  const successfulTexts = results.filter(r => r.success && r.text.trim().length > 0);

  if (!successfulTexts.length) {
    console.warn(`No solicitation texts loaded for projectId=${projectId}, opportunityId=${opportunityId}`);
    return '';
  }

  let merged: string;
  if (successfulTexts.length === 1) {
    merged = successfulTexts[0]!.text;
  } else {
    merged = successfulTexts
      .map((r, i) => `--- Document ${i + 1}: ${r.fileName} ---\n${r.text}`)
      .join('\n\n');
  }

  console.log(`Loaded ${successfulTexts.length} solicitation document(s) for projectId=${projectId}`);

  if (maxChars && merged.length > maxChars) {
    return merged.slice(0, maxChars) + '\n\n[TRUNCATED]';
  }

  return merged;
}

export async function loadLatestQuestionFile(projectId: string, opportunityId?: string): Promise<QuestionFileItem> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  // Build SK prefix based on whether opportunityId is provided
  const skPrefix = opportunityId
    ? `${projectId}#${opportunityId}#`  // Filter by project AND opportunity
    : `${projectId}#`;                   // Filter by project only

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
          ':skPrefix': skPrefix,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items?.length) items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (!items.length) {
    const context = opportunityId
      ? `projectId=${projectId}, opportunityId=${opportunityId}`
      : `projectId=${projectId}`;
    throw new Error(`No QuestionFiles found for ${context}`);
  }

  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

export async function getExecutiveBrief(sk: string): Promise<ExecutiveBriefItem> {
  const item = await getItem<ExecutiveBriefItem>(
    EXEC_BRIEF_PK,
    sk
  );
  if (!item) throw new Error(`ExecutiveBrief not found: ${sk}`);
  return item;
}

/**
 * Get executive brief by project ID (and optionally opportunity ID).
 * If opportunityId is provided, returns the brief for that specific opportunity.
 * Otherwise, returns the latest brief for the project.
 */
export async function getExecutiveBriefByProjectId(projectId: string, opportunityId?: string): Promise<ExecutiveBriefItem> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': EXEC_BRIEF_PK,
        ':skPrefix': `${projectId}#`,
      },
      ScanIndexForward: false, // Get most recent first
    }),
  );

  // Fix AUTO-RFP-63: Better error message when brief not found
  if (!res.Items || res.Items.length === 0) {
    const context = opportunityId
      ? `projectId=${projectId}, opportunityId=${opportunityId}`
      : `projectId=${projectId}`;
    throw new Error(`ExecutiveBrief not found for ${context}. Ensure the brief has been initialized.`);
  }

  // If opportunityId provided, filter to find the matching brief
  if (opportunityId) {
    const matchingBrief = res.Items.find((item: any) => item.opportunityId === opportunityId);
    if (matchingBrief) {
      return matchingBrief as ExecutiveBriefItem;
    }
    // If no matching brief found for this opportunity, throw error
    throw new Error(`ExecutiveBrief not found for projectId=${projectId}, opportunityId=${opportunityId}. Ensure the brief has been initialized for this opportunity.`);
  }

  // Return the most recent brief (first item due to ScanIndexForward: false)
  return res.Items[0] as ExecutiveBriefItem;
}

/**
 * Get all executive briefs for a project.
 * Returns briefs sorted by createdAt descending (most recent first).
 */
export async function getExecutiveBriefsByProjectId(projectId: string): Promise<ExecutiveBriefItem[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': EXEC_BRIEF_PK,
        ':skPrefix': `${projectId}#`,
      },
      ScanIndexForward: false, // Get most recent first
    }),
  );

  return (res.Items || []) as ExecutiveBriefItem[];
}

export async function putExecutiveBrief(item: ExecutiveBriefItem): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );
}

/**
 * Ensure a section exists in the brief (for backwards compatibility with existing briefs).
 */
async function ensureSectionExists(executiveBriefId: string, section: BriefSectionName): Promise<void> {
  const now = nowIso();
  const emptySection = { status: 'IDLE' as const, updatedAt: now };

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: EXEC_BRIEF_PK,
          [SK_NAME]: executiveBriefId,
        },
        UpdateExpression: 'SET #sections.#sec = if_not_exists(#sections.#sec, :emptySection)',
        ExpressionAttributeNames: {
          '#sections': 'sections',
          '#sec': section,
        },
        ExpressionAttributeValues: {
          ':emptySection': emptySection,
        },
      }),
    );
  } catch (err: any) {
    // Ignore errors - the section might already exist
    console.log(`ensureSectionExists for ${section}: ${err?.message || 'ok'}`);
  }
}

/**
 * Mark a section as in-progress.
 * Uses distinct attribute name prefixes to avoid DynamoDB path conflicts.
 */
export async function markSectionInProgress(args: {
  executiveBriefId: string;
  section: BriefSectionName;
  inputHash?: string;
}): Promise<void> {
  const { executiveBriefId, section, inputHash } = args;
  const now = nowIso();

  // Ensure section exists for backwards compatibility
  await ensureSectionExists(executiveBriefId, section);

  // Use distinct prefixes for section-level attributes
  const names: Record<string, string> = {
    '#pk': PK_NAME,
    '#sections': 'sections',
    '#sec': section,
    '#secStatus': 'status',
    '#secUpdatedAt': 'updatedAt',
  };

  const values: Record<string, any> = {
    ':secInProgress': 'IN_PROGRESS',
    ':secNow': now,
  };

  const setParts: string[] = [
    '#sections.#sec.#secStatus = :secInProgress',
    '#sections.#sec.#secUpdatedAt = :secNow',
  ];

  if (inputHash) {
    setParts.push('#sections.#sec.#secInputHash = :secHash');
    names['#secInputHash'] = 'inputHash';
    values[':secHash'] = inputHash;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: EXEC_BRIEF_PK,
          [SK_NAME]: executiveBriefId,
        },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(#pk)',
      }),
    );
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      throw new Error(`Executive brief not found: ${executiveBriefId}`);
    }
    throw err;
  }
}

/**
 * Mark a section as complete with its data.
 * Fixes AUTO-RFP-5R and AUTO-RFP-5Y: Uses separate attribute names for section vs top-level
 * to avoid DynamoDB document path conflicts.
 */
export async function markSectionComplete<T>(args: {
  executiveBriefId: string;
  section: BriefSectionName;
  data: T;
  topLevelPatch?: Partial<
    Pick<ExecutiveBriefItem, 'compositeScore' | 'recommendation' | 'decision' | 'confidence' | 'status'>
  >;
}): Promise<void> {
  const { executiveBriefId, section, data, topLevelPatch } = args;
  const now = nowIso();

  // Use distinct attribute names for section-level vs top-level to avoid path conflicts
  const sectionNames: Record<string, string> = {
    '#sections': 'sections',
    '#sec': section,
    '#secStatus': 'status',
    '#secUpdatedAt': 'updatedAt',
    '#secData': 'data',
    '#secError': 'error',
  };

  const sectionValues: Record<string, any> = {
    ':secStatus': 'COMPLETE',
    ':secNow': now,
    ':secData': data,
  };

  const sectionSetParts: string[] = [
    '#sections.#sec.#secStatus = :secStatus',
    '#sections.#sec.#secUpdatedAt = :secNow',
    '#sections.#sec.#secData = :secData',
  ];

  const removeParts: string[] = [
    '#sections.#sec.#secError',
  ];

  // Handle topLevelPatch updates in a single atomic update to avoid race conditions
  if (topLevelPatch && (
    topLevelPatch.compositeScore !== undefined ||
    topLevelPatch.recommendation !== undefined ||
    topLevelPatch.decision !== undefined ||
    topLevelPatch.confidence !== undefined ||
    topLevelPatch.status !== undefined
  )) {
    // Build combined update with distinct names for top-level attributes
    const combinedNames: Record<string, string> = { ...sectionNames };
    const combinedValues: Record<string, any> = { ...sectionValues };
    const topLevelSetParts: string[] = [];

    if (topLevelPatch.compositeScore !== undefined) {
      topLevelSetParts.push('compositeScore = :topCs');
      combinedValues[':topCs'] = topLevelPatch.compositeScore;
    }
    if (topLevelPatch.recommendation !== undefined) {
      topLevelSetParts.push('recommendation = :topRec');
      combinedValues[':topRec'] = topLevelPatch.recommendation;
    }
    if (topLevelPatch.decision !== undefined) {
      topLevelSetParts.push('decision = :topDec');
      combinedValues[':topDec'] = topLevelPatch.decision;
    }
    if (topLevelPatch.confidence !== undefined) {
      topLevelSetParts.push('confidence = :topConf');
      combinedValues[':topConf'] = topLevelPatch.confidence;
    }
    if (topLevelPatch.status !== undefined) {
      // Use distinct name for top-level status to avoid conflict with section status
      topLevelSetParts.push('#topStatus = :topStatusVal');
      combinedNames['#topStatus'] = 'status';
      combinedValues[':topStatusVal'] = topLevelPatch.status;
    }

    // Add top-level updatedAt with distinct value placeholder
    topLevelSetParts.push('#topUpdatedAt = :topNow');
    combinedNames['#topUpdatedAt'] = 'updatedAt';
    combinedValues[':topNow'] = now;

    const allSetParts = [...sectionSetParts, ...topLevelSetParts];
    const updateExpression =
      `SET ${allSetParts.join(', ')}` + (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');

    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: EXEC_BRIEF_PK, [SK_NAME]: executiveBriefId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: combinedNames,
        ExpressionAttributeValues: combinedValues,
      }),
    );
  } else {
    // No top-level patch, just update section and top-level updatedAt
    sectionNames['#topUpdatedAt'] = 'updatedAt';
    sectionValues[':topNow'] = now;
    sectionSetParts.push('#topUpdatedAt = :topNow');

    const updateExpression =
      `SET ${sectionSetParts.join(', ')}` + (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');

    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: EXEC_BRIEF_PK, [SK_NAME]: executiveBriefId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: sectionNames,
        ExpressionAttributeValues: sectionValues,
      }),
    );
  }
}

/**
 * Mark a section as failed with an error message.
 * Uses distinct attribute name prefixes to avoid DynamoDB path conflicts.
 */
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
        'SET #sections.#sec.#secStatus = :secStatus, #sections.#sec.#secError = :secErr, #sections.#sec.#secUpdatedAt = :secNow',
      ExpressionAttributeNames: {
        '#sections': 'sections',
        '#sec': section,
        '#secStatus': 'status',
        '#secError': 'error',
        '#secUpdatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':secStatus': 'FAILED',
        ':secNow': now,
        ':secErr': message,
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

export async function queryCompanyKnowledgeBase(orgId: string, solicitationText: string, topK: number): Promise<PineconeHit[]> {
  const embeddings = await getEmbedding(solicitationText);
  return await semanticSearchChunks(orgId, embeddings, topK);
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

  const responseBody = await invokeModel(
    modelId,
    JSON.stringify(body),
    'application/json',
    'application/json'
  );
  let jsonText = new TextDecoder('utf-8').decode(responseBody);

  try {
    const json = JSON.parse(jsonText);
    const contentText =
      json?.content?.map((c: any) => c?.text).filter(Boolean).join('\n') ??
      json?.output_text ??
      json?.completion ??
      null;
    if (contentText) {
      jsonText = contentText;
    }
  } catch {
    // keep rawOutput
  }

  try {
    return safeJsonParse(jsonText, outputSchema);
  } catch (e) {
    console.error('Claude raw output:', jsonText);
    throw e;
  }
}

export async function loadSolicitationForBrief(brief: ExecutiveBriefItem): Promise<{ solicitationText: string; textKeys: string[] }> {
  const bucket = brief.documentsBucket || DOCUMENTS_BUCKET;

  // ── Step 1: Dynamically fetch ALL current processed question files for this opportunity ──
  // This ensures newly uploaded documents are always included, even if uploaded after init.
  let dynamicTextKeys: string[] = [];
  try {
    const liveFiles = await loadAllQuestionFiles(brief.projectId, brief.opportunityId as string);
    const processedFiles = liveFiles.filter((f: any) => f.textFileKey && f.status === 'PROCESSED');
    dynamicTextKeys = processedFiles.map((f: any) => f.textFileKey).filter(Boolean) as string[];
    console.log(`loadSolicitationForBrief: found ${dynamicTextKeys.length} live processed files for opportunityId=${brief.opportunityId}`);
  } catch (err) {
    console.warn(`loadSolicitationForBrief: failed to fetch live question files, falling back to allTextKeys:`, (err as Error)?.message);
  }

  // ── Step 2: Merge with stored allTextKeys (union, deduplicated) ──
  // Prefer live keys but keep any stored keys that may not be in the live query result.
  const storedKeys = (brief.allTextKeys ?? []).filter(Boolean) as string[];
  const allKeys = Array.from(new Set([...dynamicTextKeys, ...storedKeys]));

  if (allKeys.length === 0) {
    throw new Error(
      `No processed question files found for brief. ` +
      `projectId=${brief.projectId}, opportunityId=${brief.opportunityId}. ` +
      `Please upload and process solicitation documents before generating the brief.`
    );
  }

  console.log(`loadSolicitationForBrief: loading ${allKeys.length} text key(s) (${dynamicTextKeys.length} live + ${storedKeys.length} stored, deduplicated)`);

  // ── Step 3: Load all text files in parallel ──
  const textPromises = allKeys.map(async (textKey) => {
    try {
      const text = await loadTextFromS3(bucket, textKey);
      return { textKey, text, success: true };
    } catch (err) {
      console.warn(`Failed to load text from ${textKey}:`, (err as Error)?.message);
      return { textKey, text: '', success: false };
    }
  });

  const results = await Promise.all(textPromises);

  const successfulResults = results.filter(
    (r): r is { textKey: string; text: string; success: true } =>
      r.success && r.text.trim().length > 0
  );

  if (successfulResults.length === 0) {
    const failedKeys = results.filter(r => !r.success).map(r => r.textKey);
    throw new Error(
      `Failed to load any solicitation text. ` +
      `Attempted ${allKeys.length} key(s). Failed: ${failedKeys.join(', ')}. ` +
      `bucket=${bucket}, projectId=${brief.projectId}, opportunityId=${brief.opportunityId}`
    );
  }

  // ── Step 4: Merge texts with document separators ──
  let solicitationText: string;
  if (successfulResults.length === 1) {
    solicitationText = successfulResults[0]!.text;
  } else {
    solicitationText = successfulResults
      .map((r, i) => `\n\n=== DOCUMENT ${i + 1} of ${successfulResults.length} ===\n\n${r.text}`)
      .join('');
  }

  const trimmedLength = solicitationText.trim().length;
  if (trimmedLength < 20) {
    throw new Error(
      `Merged solicitation text is too short (${trimmedLength} chars). ` +
      `Loaded ${successfulResults.length} document(s). ` +
      `bucket=${bucket}, projectId=${brief.projectId}, opportunityId=${brief.opportunityId}`
    );
  }

  console.log(`loadSolicitationForBrief: loaded ${successfulResults.length} document(s), ${solicitationText.length} total chars`);

  return { solicitationText, textKeys: successfulResults.map(r => r.textKey) };
}

/**
 * Build a stable idempotency hash per section.
 * Use opportunityId + allTextKeys + sectionName to detect reruns.
 * NOTE: questionFileId removed - we now use opportunityId since question files are retrieved by opportunityId
 */
export function buildSectionInputHash(args: {
  executiveBriefId: string;
  section: BriefSectionName;
  opportunityId: string;
  allTextKeys?: string[] | null;
}): string {
  const { executiveBriefId, section, opportunityId, allTextKeys } = args;
  const keysStr = allTextKeys?.filter(Boolean).sort().join(',') || '';
  return sha256(`${executiveBriefId}:${section}:${opportunityId}:${keysStr}`);
}

/**
 * Build a deterministic SK for a brief tied to a specific opportunity.
 * This ensures only one brief exists per project+opportunity combination.
 */
export const executiveBriefSKByOpportunity = (projectId: string, opportunityId: string) => {
  return `${projectId}#${opportunityId}`;
};
