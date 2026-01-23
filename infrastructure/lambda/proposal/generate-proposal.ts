import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
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
import { invokeModel } from '../helpers/bedrock-http-client';
import { DBProjectItem } from '../types/project';
import { loadLatestQuestionFile } from '../helpers/executive-opportunity-brief';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_TOKENS = Number(requireEnv('BEDROCK_MAX_TOKENS', '4000'));
const TEMPERATURE = Number(requireEnv('BEDROCK_TEMPERATURE', '0.1'));
// Max chars for solicitation to prevent "input too long" errors - fixes AUTO-RFP-44
const MAX_SOLICITATION_CHARS = Number(requireEnv('PROPOSAL_MAX_SOLICITATION_CHARS', '80000'));

type QaPair = GenerateProposalRequest['qaPairs'][number];

const extractOrgIdFromSortKey = (sortKey: string): string => {
  const [orgId] = String(sortKey ?? '').split('#');
  return orgId || '';
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
    const parsedBody = JSON.parse(event?.body || '');

    const inputResult = GenerateProposalInputSchema.safeParse(parsedBody);
    if (!inputResult.success) {
      return apiResponse(400, { message: 'Validation error', errors: inputResult.error.format() });
    }

    const { projectId } = inputResult.data;

    // 1) Load project
    const projectItem = await getProjectById(projectId);
    if (!projectItem) return apiResponse(404, { message: 'Project not found' });

    const { sort_key } = projectItem as DBProjectItem;
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

    const { fileKey } = await loadLatestQuestionFile(projectId);
    let solicitation = fileKey ? await loadTextFromS3(DOCUMENTS_BUCKET, fileKey) : '';

    // Truncate solicitation to prevent "input too long" errors - fixes AUTO-RFP-44
    if (solicitation.length > MAX_SOLICITATION_CHARS) {
      console.warn(`Truncating solicitation from ${solicitation.length} to ${MAX_SOLICITATION_CHARS} chars`);
      solicitation = solicitation.slice(0, MAX_SOLICITATION_CHARS);
    }

    const reqParsed = GenerateProposalRequestSchema.safeParse(llmRequestCandidate);
    if (!reqParsed.success) {
      return apiResponse(400, {
        message: 'Invalid proposal generation payload',
        issues: reqParsed.error.format(),
      });
    }

    const systemPrompt = await useProposalSystemPrompt(orgId);
    const userPrompt = await useProposalUserPrompt(
      orgId,
      solicitation,
      JSON.stringify(qaPairs.map(({ question, answer }) => ({ question, answer }))),
      ''
    );

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

    const responseBody = await invokeModel(BEDROCK_MODEL_ID, body);
    const responseString = new TextDecoder('utf-8').decode(responseBody);
    const outer = JSON.parse(responseString);

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