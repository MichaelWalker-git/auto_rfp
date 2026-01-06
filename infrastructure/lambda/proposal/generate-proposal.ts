import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { QUESTION_PK } from '../constants/question';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getProjectById } from '../helpers/project';
import middy from '@middy/core';
import {
  GenerateProposalInputSchema,
  type GenerateProposalRequest,
  GenerateProposalRequestSchema,
  type ProposalDocument,
  ProposalDocumentSchema,
} from '@auto-rfp/shared';
import { requireEnv } from '../helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import { docClient } from '../helpers/db';
import { safeParseJsonFromModel } from '../helpers/json';
import { loadTextFromS3 } from '../helpers/s3';
import { useProposalSystemPrompt, useProposalUserPrompt } from '../constants/prompt';

const BEDROCK_REGION = requireEnv('BEDROCK_REGION');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_TOKENS = Number(requireEnv('BEDROCK_MAX_TOKENS', '4000'));
const TEMPERATURE = Number(requireEnv('BEDROCK_TEMPERATURE', '0.1'));

const bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });

type QaPair = GenerateProposalRequest['qaPairs'][number];
type KnowledgeBaseSnippet = NonNullable<GenerateProposalRequest['knowledgeBaseSnippets']>[number];

const extractOrgIdFromSortKey = (sortKey: string): string => {
  const [orgId] = String(sortKey ?? '').split('#');
  return orgId || '';
};

const loadKnowledgeBasesForOrg = async (orgId: string): Promise<any[]> => {
  const skPrefix = `${orgId}#`;

  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': KNOWLEDGE_BASE_PK, ':skPrefix': skPrefix },
    }),
  );

  return Items ?? [];
};

const loadDocumentsForKnowledgeBase = async (knowledgeBaseId: string): Promise<any[]> => {
  const skPrefix = `KB#${knowledgeBaseId}#DOC#`;

  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': DOCUMENT_PK, ':skPrefix': skPrefix },
    }),
  );

  return Items ?? [];
};

const loadQaPairsForProject = async (projectId: string): Promise<QaPair[]> => {
  const skPrefix = `${projectId}#`;

  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': QUESTION_PK, ':skPrefix': skPrefix },
    }),
  );

  if (!Items?.length) return [];

  return Items.map((item: any) => ({
    questionId: item.questionId,
    question: item.question ?? '',
    answer: item.answer ?? '',
  })) as QaPair[];
};

const buildKnowledgeBaseSnippets = async (documents: any[]): Promise<KnowledgeBaseSnippet[]> => {
  const snippets: KnowledgeBaseSnippet[] = [];

  for (const doc of documents) {
    const key = doc?.textFileKey;
    if (!key) continue;

    const content = await loadTextFromS3(DOCUMENTS_BUCKET, key);
    if (!content.trim()) continue;

    snippets.push({
      id: doc.id,
      type: 'OTHER',
      title: doc.name,
      content,
      sourceDocumentName: doc.name,
    });
  }

  return snippets;
};

const buildUserPromptForProposal = async (orgId: string, payload: GenerateProposalRequest): Promise<string | undefined> => {
  const { qaPairs, knowledgeBaseSnippets } = payload;

  const metaLines: string[] = [];
  Object.entries({/*TODO use row for solicitation entity*/ }).forEach(([k, v]) => {
    if (v) metaLines.push(`${k}: ${v}`);
  });

  const qaText =
    qaPairs.length > 0
      ? qaPairs.map((qa, idx) => `Q${idx + 1}: ${qa.question}\nA${idx + 1}: ${qa.answer}`).join('\n\n')
      : 'None';

  const kbText =
    (knowledgeBaseSnippets ?? []).length > 0
      ? (knowledgeBaseSnippets ?? [])
        .map((s, idx) => {
          const headerParts = [
            s.type ? `[${s.type}]` : '',
            s.title ?? `Snippet ${idx + 1}`,
            s.sourceDocumentName ? `(source: ${s.sourceDocumentName})` : '',
          ].filter(Boolean);
          return `${headerParts.join(' ')}\n${s.content}`;
        })
        .join('\n\n---\n\n')
      : 'None';

  return await useProposalUserPrompt(
    orgId,
    '',
    qaText,
    kbText
  );
};


const extractBedrockText = (outer: any): string => {
  const t1 = outer?.content?.[0]?.text;
  if (typeof t1 === 'string' && t1.trim()) return t1;
  const t2 = outer?.output_text;
  if (typeof t2 === 'string' && t2.trim()) return t2;
  const t3 = outer?.completion;
  if (typeof t3 === 'string' && t3.trim()) return t3;
  return '';
};

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) return apiResponse(400, { message: 'Request body is required' });

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const inputResult = GenerateProposalInputSchema.safeParse(parsedBody);
    if (!inputResult.success) {
      return apiResponse(400, { message: 'Validation error', errors: inputResult.error.format() });
    }

    const { projectId } = inputResult.data;

    // 1) Load project
    const projectItem = await getProjectById(projectId);
    if (!projectItem) return apiResponse(404, { message: 'Project not found' });

    const { sort_key, ...project } = projectItem as any;
    const orgId = extractOrgIdFromSortKey(sort_key);
    if (!orgId) return apiResponse(400, { message: 'Project has invalid sort_key (cannot extract orgId)' });

    // 5) Load Q/A pairs
    const qaPairs = await loadQaPairsForProject(projectId);
    if (qaPairs.length === 0) {
      return apiResponse(400, { message: 'No questions found for this project' });
    }

    // 7) Build request payload and validate it against shared schema
    const llmRequestCandidate = {
      projectId,
      qaPairs,
      knowledgeBaseSnippets: [],
      requestedSections: undefined,
    };

    const reqParsed = GenerateProposalRequestSchema.safeParse(llmRequestCandidate);
    if (!reqParsed.success) {
      return apiResponse(400, {
        message: 'Invalid proposal generation payload',
        issues: reqParsed.error.format(),
      });
    }

    const systemPrompt = await useProposalSystemPrompt(orgId);
    const userPrompt = await buildUserPromptForProposal(orgId, reqParsed.data);

    if (!userPrompt?.trim() || !systemPrompt?.trim()) {
      return apiResponse(500, { message: 'User prompt is empty' });
    }

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await bedrockClient.send(command);
    const responseBodyString = new TextDecoder().decode(response.body);
    const outer = JSON.parse(responseBodyString);

    const textChunk = extractBedrockText(outer);
    const modelJson = safeParseJsonFromModel(textChunk);

    const proposalResult = ProposalDocumentSchema.safeParse(modelJson);
    if (!proposalResult.success) {
      console.error('Proposal validation failed', proposalResult.error, { modelJson });
      return apiResponse(502, {
        message: 'Model did not return a valid proposal document',
        issues: proposalResult.error.format(),
        raw: modelJson,
      });
    }

    const proposal: ProposalDocument = proposalResult.data;
    return apiResponse(200, proposal);
  } catch (err: any) {
    console.error('Error in generate-proposal handler:', err);
    return apiResponse(500, {
      message: 'Internal server error during proposal generation',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware())
);