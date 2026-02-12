import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getProjectById } from '../helpers/project';
import { requireEnv } from '../helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { docClient } from '../helpers/db';
import { safeParseJsonFromModel } from '../helpers/json';
import { loadTextFromS3 } from '../helpers/s3';
import { useProposalUserPrompt } from '../constants/prompt';
import { invokeModel } from '../helpers/bedrock-http-client';
import { DBProjectItem } from '../types/project';
import { loadLatestQuestionFile } from '../helpers/executive-opportunity-brief';
import { getTemplate, listTemplatesByOrg } from '../helpers/template';
import { type ProposalDocument, ProposalDocumentSchema, TEMPLATE_CATEGORY_LABELS } from '@auto-rfp/shared';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_TOKENS = Number(requireEnv('BEDROCK_MAX_TOKENS', '4000'));
const TEMPERATURE = Number(requireEnv('BEDROCK_TEMPERATURE', '0.1'));
const MAX_SOLICITATION_CHARS = Number(requireEnv('PROPOSAL_MAX_SOLICITATION_CHARS', '80000'));

// ─── Input Schema ───

const GenerateDocumentInputSchema = z.object({
  projectId: z.string().min(1),
  documentType: z.string().min(1).default('TECHNICAL_PROPOSAL'),
  templateId: z.string().optional(),
});

// ─── Helpers ───

const extractOrgIdFromSortKey = (sortKey: string): string => {
  const [orgId] = String(sortKey ?? '').split('#');
  return orgId || '';
};

const loadQaPairsForProject = async (projectId: string) => {
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
  }));
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

/**
 * Build a system prompt for document generation with document type and optional template structure.
 */
function buildSystemPromptForDocumentType(
  documentType: string,
  templateSections: any[] | null,
): string {
  const typeLabel = TEMPLATE_CATEGORY_LABELS[documentType as keyof typeof TEMPLATE_CATEGORY_LABELS]
    ?? documentType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  let systemPrompt = `You are an expert proposal writer for US government and commercial RFPs.

You are generating a ${typeLabel} document.

Return ONLY valid JSON with this structure:

{
  "proposalTitle": string,
  "customerName"?: string,
  "opportunityId"?: string,
  "outlineSummary"?: string,
  "sections": [
    {
      "id": string,
      "title": string,
      "summary"?: string,
      "subsections": [
        { "id": string, "title": string, "content": string }
      ]
    }
  ]
}

DOCUMENT TYPE SPECIFIC GUIDANCE:
`;

  // Add document type specific guidance
  switch (documentType) {
    case 'TECHNICAL_PROPOSAL':
      systemPrompt += `
- Focus on technical approach, methodology, and solution architecture
- Emphasize technical capabilities, tools, technologies, and processes
- Include sections for technical approach, management approach, staffing, and quality assurance
- Demonstrate understanding of technical requirements`;
      break;
    case 'MANAGEMENT_PROPOSAL':
      systemPrompt += `
- Focus on management approach, organizational structure, and project management methodology
- Emphasize program management, risk management, and quality management processes
- Include sections for management approach, organization chart, key personnel, and communication plan
- Demonstrate understanding of how to manage the contract effectively`;
      break;
    case 'PAST_PERFORMANCE':
      systemPrompt += `
- Focus on relevant past contracts and performance history
- Emphasize similar work, customer satisfaction, and performance ratings
- Include sections for each relevant contract with description, outcomes, and relevance
- Demonstrate track record of successful delivery`;
      break;
    case 'PRICE_VOLUME':
    case 'COST_PROPOSAL':
      systemPrompt += `
- Focus on pricing structure, cost breakdown, and value proposition
- Emphasize cost elements, labor categories, rates, and any assumptions
- Include sections for pricing summary, cost breakdown, and basis of estimate
- Demonstrate competitive and reasonable pricing`;
      break;
    case 'EXECUTIVE_SUMMARY':
      systemPrompt += `
- Provide a high-level overview of the entire proposal
- Emphasize key differentiators, win themes, and value proposition
- Keep content concise and compelling for executive decision makers
- Highlight understanding of requirements and proposed solution benefits`;
      break;
    case 'CERTIFICATIONS':
      systemPrompt += `
- Focus on compliance certifications and representations
- Include relevant certifications, attestations, and compliance statements
- Ensure all required certifications are addressed
- Organize by certification type or requirement`;
      break;
    default:
      systemPrompt += `
- Organize content logically for the ${typeLabel} document type
- Use professional government contracting language
- Ensure all content is relevant and well-structured`;
  }

  systemPrompt += `

GENERAL RULES:
- Use information from Q&A and knowledge base snippets wherever relevant.
- If unknown, use generic language. Do NOT invent specific numbers, dates, IDs.
- Do NOT include any text outside JSON.`;

  // Add template structure if available
  if (templateSections && templateSections.length > 0) {
    const sectionOutline = templateSections
      .map((s, i) => `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`)
      .join('\n');

    systemPrompt += `

TEMPLATE STRUCTURE (REQUIRED):
You must structure the output following this exact template structure:

${sectionOutline}

Each section from the template must appear as a section in the output JSON. Use the template section titles as section titles. Fill in the content based on the solicitation requirements and Q&A pairs provided.`;
  }

  return systemPrompt;
}

// ─── Handler ───

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const parsedBody = JSON.parse(event?.body || '');
    const inputResult = GenerateDocumentInputSchema.safeParse(parsedBody);
    if (!inputResult.success) {
      return apiResponse(400, { message: 'Validation error', errors: inputResult.error.format() });
    }

    const { projectId, documentType, templateId } = inputResult.data;

    // Load project
    const projectItem = await getProjectById(projectId);
    if (!projectItem) return apiResponse(404, { message: 'Project not found' });

    const { sort_key } = projectItem as DBProjectItem;
    const orgId = extractOrgIdFromSortKey(sort_key);
    if (!orgId) return apiResponse(400, { message: 'Cannot extract orgId from project' });

    // Load Q/A pairs
    const qaPairs = await loadQaPairsForProject(projectId);
    if (qaPairs.length === 0) {
      return apiResponse(400, { message: 'No questions found for this project' });
    }

    // Load solicitation text
    const { fileKey } = await loadLatestQuestionFile(projectId);
    let solicitation = fileKey ? await loadTextFromS3(DOCUMENTS_BUCKET, fileKey) : '';
    if (solicitation.length > MAX_SOLICITATION_CHARS) {
      solicitation = solicitation.slice(0, MAX_SOLICITATION_CHARS);
    }

    // Try to find a matching template
    let templateSections: any[] | null = null;

    if (templateId) {
      // Use specific template
      const template = await getTemplate(orgId, templateId);
      if (template?.sections) {
        templateSections = template.sections;
      }
    } else {
      // Auto-find a published template matching the document type
      try {
        const { items } = await listTemplatesByOrg(orgId, {
          category: documentType,
          status: 'PUBLISHED',
          limit: 1,
        });
        const firstTemplate = items?.[0];
        if (firstTemplate?.sections) {
          templateSections = firstTemplate.sections;
        }
      } catch {
        // No template found — use default prompts
      }
    }

    // Build prompts - system prompt is now document-type specific
    const systemPrompt = buildSystemPromptForDocumentType(documentType, templateSections);

    const userPrompt = await useProposalUserPrompt(
      orgId,
      solicitation,
      JSON.stringify(qaPairs.map(({ question, answer }) => ({ question, answer }))),
      '',
    );

    if (!userPrompt?.trim() || !systemPrompt?.trim()) {
      return apiResponse(500, { message: 'Prompt generation failed' });
    }

    // Call Bedrock
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
      console.error('Document validation failed', proposalResult.error, { modelJson });
      return apiResponse(502, {
        message: 'Model did not return a valid document',
        issues: proposalResult.error.format(),
        raw: modelJson,
        rawModelResponse: textChunk,
      });
    }

    const document: ProposalDocument = proposalResult.data;
    return apiResponse(200, {
      ...document,
      documentType,
      templateUsed: !!templateSections,
      rawModelResponse: textChunk,
    });
  } catch (err: any) {
    console.error('Error in generate-document handler:', err);
    return apiResponse(500, {
      message: 'Internal server error during document generation',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);