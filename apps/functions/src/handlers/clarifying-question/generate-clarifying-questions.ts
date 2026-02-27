import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { createClarifyingQuestionsBatch, listClarifyingQuestionsByOpportunity } from '@/helpers/clarifying-question';
import { getOpportunity } from '@/helpers/opportunity';
import {
  getExecutiveBriefByProjectId,
  loadAllSolicitationTexts,
  queryCompanyKnowledgeBase,
  invokeClaudeJson,
  truncateText,
} from '@/helpers/executive-opportunity-brief';
import { requireEnv } from '@/helpers/env';
import {
  getClarifyingQuestionsSystemPrompt,
  useClarifyingQuestionsUserPrompt,
} from '@/constants/prompt';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

import type {
  ClarifyingQuestionCategory,
  ClarifyingQuestionPriority,
  AmbiguitySource,
} from '@auto-rfp/core';

const RequestBodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  force: z.boolean().default(false),
  topK: z.number().int().min(1).max(20).default(10),
});

// Schema for parsing AI response
const AIQuestionSchema = z.object({
  question: z.string().min(10),
  category: z.enum(['SCOPE', 'TECHNICAL', 'PRICING', 'SCHEDULE', 'COMPLIANCE', 'EVALUATION', 'OTHER']),
  rationale: z.string().min(10),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  ambiguitySource: z.object({
    snippet: z.string().optional(),
    sectionRef: z.string().optional(),
  }).optional(),
});

const AIResponseSchema = z.array(AIQuestionSchema);

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(401, { ok: false, error: 'Unauthorized' });
  }

  // Parse body
  let body: unknown;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const parseResult = RequestBodySchema.safeParse(body);
  if (!parseResult.success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid request body',
      details: parseResult.error.flatten(),
    });
  }

  const { projectId, opportunityId, force, topK } = parseResult.data;

  // Check if questions already exist (unless force=true)
  if (!force) {
    const existing = await listClarifyingQuestionsByOpportunity({
      orgId,
      projectId,
      opportunityId,
      limit: 1,
    });

    if (existing.items.length > 0) {
      return apiResponse(200, {
        ok: true,
        message: 'Clarifying questions already exist. Use force=true to regenerate.',
        questionsGenerated: 0,
        questions: [],
      });
    }
  }

  // Get opportunity to verify it exists
  const opportunity = await getOpportunity({ orgId, projectId, oppId: opportunityId });
  if (!opportunity) {
    return apiResponse(404, { ok: false, error: 'Opportunity not found' });
  }

  // Get executive brief for context
  let brief;
  try {
    brief = await getExecutiveBriefByProjectId(projectId, opportunityId);
  } catch {
    brief = null;
  }

  // Build context for AI
  let summaryText = 'None';
  let requirementsText = 'None';
  let evaluationText = 'None';
  let deadlinesText = 'None';
  let risksText = 'None';

  if (brief) {
    if (brief.summary) {
      summaryText = JSON.stringify(brief.summary);
    }
    if (brief.requirements) {
      requirementsText = JSON.stringify(brief.requirements);
      // Extract evaluation factors if present - cast to any to access dynamic property
      const reqData = brief.requirements as Record<string, unknown>;
      if (reqData.evaluationFactors) {
        evaluationText = JSON.stringify(reqData.evaluationFactors);
      }
    }
    if (brief.deadlines) {
      deadlinesText = JSON.stringify(brief.deadlines);
    }
    if (brief.risks) {
      risksText = JSON.stringify(brief.risks);
    }
  }

  // Get solicitation text - truncate to avoid exceeding model context limits
  const MAX_SOLICITATION_CHARS = 30000; // Use smaller limit for clarifying questions
  const rawSolicitationText = await loadAllSolicitationTexts(projectId, opportunityId) || 'None';
  const solicitationText = truncateText(rawSolicitationText, MAX_SOLICITATION_CHARS);

  // Get KB context from semantic search - use truncated text for query
  let kbText = 'None';
  try {
    const kbHits = await queryCompanyKnowledgeBase(orgId, solicitationText.slice(0, 3000), 5);
    if (kbHits.length > 0) {
      // PineconeHit has values and text in different locations
      const kbParts = kbHits.map(hit => {
        const hitData = hit as Record<string, unknown>;
        return (hitData.text as string) || '';
      }).filter(Boolean);
      // Limit KB text to avoid making prompt too long
      kbText = truncateText(kbParts.join('\n\n---\n\n'), 5000);
    }
  } catch {
    console.warn('Failed to query KB, continuing without KB context');
  }

  // Build prompts
  const systemPrompt = await getClarifyingQuestionsSystemPrompt(orgId);
  const userPrompt = await useClarifyingQuestionsUserPrompt(
    orgId,
    solicitationText,
    summaryText,
    requirementsText,
    evaluationText,
    deadlinesText,
    risksText,
    kbText,
    topK
  );

  // Call AI using Claude
  const CLAUDE_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
  let parsedQuestions: z.infer<typeof AIResponseSchema>;
  
  try {
    // Use a wrapper schema that returns an array
    const ArrayWrapperSchema = {
      parse: (data: unknown) => AIResponseSchema.parse(data),
    };
    
    parsedQuestions = await invokeClaudeJson({
      modelId: CLAUDE_MODEL_ID,
      system: systemPrompt,
      user: userPrompt,
      outputSchema: ArrayWrapperSchema,
      maxTokens: 4000,
      temperature: 0.7,
    });
  } catch (err) {
    console.error('Failed to generate clarifying questions:', err);
    return apiResponse(500, {
      ok: false,
      error: 'Failed to generate clarifying questions',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  // Transform to our schema format and save
  const questionsToSave = parsedQuestions.map((q) => ({
    question: q.question,
    category: q.category as ClarifyingQuestionCategory,
    rationale: q.rationale,
    priority: q.priority as ClarifyingQuestionPriority,
    ambiguitySource: q.ambiguitySource as AmbiguitySource | undefined,
    status: 'SUGGESTED' as const,
    responseReceived: false,
  }));

  const result = await createClarifyingQuestionsBatch({
    orgId,
    projectId,
    opportunityId,
    questions: questionsToSave,
  });

  setAuditContext(event, {
    action: 'CLARIFYING_QUESTION_GENERATED',
    resource: 'clarifying-question',
    resourceId: opportunityId,
    orgId,
    changes: {
      after: {
        projectId,
        opportunityId,
        questionsGenerated: result.count,
      },
    },
  });

  return apiResponse(200, {
    ok: true,
    projectId,
    opportunityId,
    questionsGenerated: result.count,
    questions: result.items,
  });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware()),
);
