import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '../../sentry-lambda';
import { type ExecutiveBriefItem } from '@auto-rfp/core';
import { getPastProject } from '@/helpers/past-performance';
import {
  getExecutiveBrief,
  loadSolicitationForBrief,
  truncateText,
  invokeClaudeJson,
} from '@/helpers/executive-opportunity-brief';
import { apiResponse } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID', 'anthropic.claude-3-haiku-20240307-v1:0');
const MAX_SOLICITATION_CHARS = Number(requireEnv('BRIEF_MAX_SOLICITATION_CHARS', '45000'));

const GenerateNarrativeRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  projectId: z.string().uuid().optional(),
  force: z.boolean().optional().default(false),
});

const NarrativeOutputSchema = z.object({
  narrative: z.string().min(50),
  keyStrengths: z.array(z.string()).default([]),
  relevantAchievements: z.array(z.string()).default([]),
  clientSatisfaction: z.string().optional().nullable(),
});

const NARRATIVE_SYSTEM_PROMPT = `You are an expert government proposal writer specializing in past performance narratives.

Your task is to generate a compelling past performance narrative that demonstrates relevance to the current opportunity.

STRICT OUTPUT CONTRACT:
- Output ONLY a single valid JSON object.
- Do NOT output any text before "{" or after "}".
- No prose, no markdown, no code fences.

OUTPUT SCHEMA:
{
  "narrative": "string (min 50 chars) - The full past performance narrative",
  "keyStrengths": ["string"] - Key strengths demonstrated by this project,
  "relevantAchievements": ["string"] - Specific achievements relevant to the opportunity,
  "clientSatisfaction": "string (optional) - Summary of client satisfaction/ratings"
}

NARRATIVE GUIDELINES:
- Focus on relevance to the current opportunity requirements
- Highlight similar scope, scale, and technical challenges
- Include specific metrics and achievements where available
- Demonstrate successful delivery and client satisfaction
- Use professional, proposal-ready language
- Keep the narrative concise but comprehensive (200-400 words)`;

const NARRATIVE_USER_PROMPT = `Generate a past performance narrative for the following project that demonstrates its relevance to the current opportunity.

PAST PROJECT DETAILS:
Title: {{PROJECT_TITLE}}
Client: {{PROJECT_CLIENT}}
Contract Number: {{CONTRACT_NUMBER}}
Period of Performance: {{PERIOD_OF_PERFORMANCE}}
Contract Value: {{CONTRACT_VALUE}}
Description: {{PROJECT_DESCRIPTION}}
Technical Approach: {{TECHNICAL_APPROACH}}
Achievements: {{ACHIEVEMENTS}}
Performance Rating: {{PERFORMANCE_RATING}}
Domain: {{DOMAIN}}
Technologies: {{TECHNOLOGIES}}

CURRENT OPPORTUNITY REQUIREMENTS:
{{REQUIREMENTS}}

SOLICITATION SUMMARY:
{{SOLICITATION_SUMMARY}}

Generate a compelling narrative that:
1. Demonstrates relevance to the current opportunity
2. Highlights similar technical challenges and solutions
3. Includes specific metrics and achievements
4. Shows successful delivery and client satisfaction

Return JSON ONLY. First char "{" last char "}".`;

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { executiveBriefId, projectId } = GenerateNarrativeRequestSchema.parse(body);

    // Load the executive brief
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const orgId = (brief as any).orgId;

    if (!orgId) {
      return apiResponse(400, {
        ok: false,
        error: 'Organization ID not found in executive brief',
      });
    }

    // Load solicitation text
    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    // Get requirements from brief
    const requirementsSection = (brief.sections as any)?.requirements?.data;
    const requirements = requirementsSection?.requirements?.map((r: any) => r.requirement).join('\n- ') || 'Not available';

    // Get summary from brief
    const summarySection = (brief.sections as any)?.summary?.data;
    const solicitationSummary = summarySection?.summary || solicitationText.slice(0, 2000);

    // If specific project ID provided, generate narrative for that project
    if (projectId) {
      const project = await getPastProject(orgId, projectId);
      if (!project) {
        return apiResponse(404, {
          ok: false,
          error: 'Past project not found',
        });
      }

      const narrative = await generateProjectNarrative(
        project,
        requirements,
        solicitationSummary
      );

      return apiResponse(200, {
        ok: true,
        projectId,
        ...narrative,
      });
    }

    // Otherwise, generate narratives for all matched projects in the brief
    const pastPerfSection = (brief.sections as any)?.pastPerformance?.data;
    if (!pastPerfSection?.topMatches?.length) {
      return apiResponse(400, {
        ok: false,
        error: 'No matched projects found. Run match-projects first.',
      });
    }

    const narratives: Array<{ projectId: string; narrative: any }> = [];

    for (const match of pastPerfSection.topMatches.slice(0, 5)) {
      try {
        const narrative = await generateProjectNarrative(
          match.project,
          requirements,
          solicitationSummary
        );
        narratives.push({
          projectId: match.project.projectId,
          narrative,
        });
      } catch (err) {
        console.error(`Failed to generate narrative for project ${match.project.projectId}:`, err);
      }
    }

    return apiResponse(200, {
      ok: true,
      narratives,
    });
  } catch (error: any) {
    console.error('Error generating narrative:', error);

    if (error.name === 'ZodError') {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: error.errors,
      });
    }

    return apiResponse(500, {
      ok: false,
      error: error.message || 'Internal server error',
    });
  }
};

async function generateProjectNarrative(
  project: any,
  requirements: string,
  solicitationSummary: string
): Promise<z.infer<typeof NarrativeOutputSchema>> {
  const userPrompt = NARRATIVE_USER_PROMPT
    .replace('{{PROJECT_TITLE}}', project.title || 'N/A')
    .replace('{{PROJECT_CLIENT}}', project.client || 'N/A')
    .replace('{{CONTRACT_NUMBER}}', project.contractNumber || 'N/A')
    .replace('{{PERIOD_OF_PERFORMANCE}}', formatPeriodOfPerformance(project.startDate, project.endDate))
    .replace('{{CONTRACT_VALUE}}', project.value ? `$${project.value.toLocaleString()}` : 'N/A')
    .replace('{{PROJECT_DESCRIPTION}}', project.description || 'N/A')
    .replace('{{TECHNICAL_APPROACH}}', project.technicalApproach || 'N/A')
    .replace('{{ACHIEVEMENTS}}', project.achievements?.join('\n- ') || 'N/A')
    .replace('{{PERFORMANCE_RATING}}', project.performanceRating ? `${project.performanceRating}/5` : 'N/A')
    .replace('{{DOMAIN}}', project.domain || 'N/A')
    .replace('{{TECHNOLOGIES}}', project.technologies?.join(', ') || 'N/A')
    .replace('{{REQUIREMENTS}}', requirements)
    .replace('{{SOLICITATION_SUMMARY}}', solicitationSummary);

  const result = await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: NARRATIVE_SYSTEM_PROMPT,
    user: userPrompt,
    outputSchema: NarrativeOutputSchema,
    maxTokens: 2000,
    temperature: 0.3,
  });

  return result;
}

function formatPeriodOfPerformance(startDate?: string | null, endDate?: string | null): string {
  if (!startDate && !endDate) return 'N/A';
  
  const formatDate = (date: string) => {
    try {
      return new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return date;
    }
  };

  if (startDate && endDate) {
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }
  if (startDate) {
    return `${formatDate(startDate)} - Present`;
  }
  return `Through ${formatDate(endDate!)}`;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware())
);