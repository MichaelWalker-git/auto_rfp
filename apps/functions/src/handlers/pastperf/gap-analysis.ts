import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '../../sentry-lambda';
import { type ExecutiveBriefItem, type GapAnalysis } from '@auto-rfp/core';
import { performGapAnalysis, matchProjectsToRequirements } from '@/helpers/past-performance';
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

const GapAnalysisRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  force: z.boolean().optional().default(false),
});

const GapRecommendationsSchema = z.object({
  recommendations: z.array(z.object({
    gap: z.string(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    recommendation: z.string(),
    potentialPartners: z.array(z.string()).optional().default([]),
    mitigationStrategy: z.string().optional().nullable(),
  })).default([]),
  overallAssessment: z.string(),
  bidRecommendation: z.enum(['PROCEED', 'PROCEED_WITH_CAUTION', 'CONSIDER_NO_BID', 'NO_BID']),
  bidRationale: z.string(),
});

const GAP_ANALYSIS_SYSTEM_PROMPT = `You are an expert government contracting capture manager analyzing past performance gaps.

Your task is to analyze gaps in past performance coverage and provide actionable recommendations.

STRICT OUTPUT CONTRACT:
- Output ONLY a single valid JSON object.
- Do NOT output any text before "{" or after "}".
- No prose, no markdown, no code fences.

OUTPUT SCHEMA:
{
  "recommendations": [
    {
      "gap": "string - The specific gap identified",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "recommendation": "string - Specific action to address the gap",
      "potentialPartners": ["string"] - Types of partners/subcontractors to consider,
      "mitigationStrategy": "string (optional) - How to mitigate if gap cannot be filled"
    }
  ],
  "overallAssessment": "string - Overall assessment of past performance position",
  "bidRecommendation": "PROCEED|PROCEED_WITH_CAUTION|CONSIDER_NO_BID|NO_BID",
  "bidRationale": "string - Rationale for the bid recommendation"
}

ANALYSIS GUIDELINES:
- Severity should reflect impact on win probability
- CRITICAL gaps are likely disqualifying
- HIGH gaps significantly reduce win probability
- MEDIUM gaps are manageable with mitigation
- LOW gaps are minor concerns
- Consider teaming, subcontracting, and JV options
- Be realistic about what can be mitigated`;

const GAP_ANALYSIS_USER_PROMPT = `Analyze the following past performance gaps and provide recommendations.

IDENTIFIED GAPS:
{{GAPS}}

CURRENT COVERAGE:
{{COVERAGE}}

OPPORTUNITY REQUIREMENTS:
{{REQUIREMENTS}}

MATCHED PROJECTS SUMMARY:
{{MATCHED_PROJECTS}}

Provide:
1. Specific recommendations for each gap
2. Potential teaming/subcontracting partners to consider
3. Mitigation strategies where gaps cannot be filled
4. Overall bid recommendation based on past performance position

Return JSON ONLY. First char "{" last char "}".`;

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error: errors } = GapAnalysisRequestSchema.safeParse(body);
    
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: errors.issues,
      });
    }
    
    const { executiveBriefId, force } = data;

    // Load the executive brief
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const orgId = (brief as any).orgId;

    if (!orgId) {
      return apiResponse(400, {
        ok: false,
        error: 'Organization ID not found in executive brief',
      });
    }

    // Get past performance section
    const pastPerfSection = (brief.sections as any)?.pastPerformance?.data;
    
    // If no past performance data, run matching first
    let gapAnalysis: GapAnalysis;
    let matches: any[] = [];

    if (!pastPerfSection?.gapAnalysis) {
      // Load solicitation and requirements
      const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
      const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

      const requirementsSection = (brief.sections as any)?.requirements?.data;
      const requirements: string[] = [];

      if (requirementsSection?.requirements) {
        for (const req of requirementsSection.requirements) {
          if (req.requirement) {
            requirements.push(req.requirement);
          }
        }
      }

      // Run matching
      matches = await matchProjectsToRequirements(orgId, requirements, solicitationText, 5);

      // Perform gap analysis
      const requirementsWithCategory = requirementsSection?.requirements?.map((r: any) => ({
        category: r.category,
        requirement: r.requirement,
      })) || requirements.map(r => ({ requirement: r }));

      gapAnalysis = await performGapAnalysis(orgId, requirementsWithCategory, matches);
    } else {
      gapAnalysis = pastPerfSection.gapAnalysis;
      matches = pastPerfSection.topMatches || [];
    }

    // If there are gaps, get AI recommendations
    let aiRecommendations = null;
    if (gapAnalysis.criticalGaps.length > 0 || gapAnalysis.overallCoverage < 80) {
      const requirementsSection = (brief.sections as any)?.requirements?.data;
      const requirements = requirementsSection?.requirements?.map((r: any) => 
        `- ${r.category || 'General'}: ${r.requirement}`
      ).join('\n') || 'Not available';

      const gapsText = gapAnalysis.coverageItems
        .filter(c => c.status !== 'COVERED')
        .map(c => `- ${c.requirement} (Status: ${c.status}, Score: ${c.matchScore || 0}%)`)
        .join('\n') || 'No gaps identified';

      const coverageText = gapAnalysis.coverageItems
        .map(c => `- ${c.requirement}: ${c.status} (${c.matchScore || 0}% match${c.matchedProjectTitle ? ` - ${c.matchedProjectTitle}` : ''})`)
        .join('\n');

      const matchedProjectsText = matches
        .map(m => `- ${m.project.title} (${m.relevanceScore}% relevance): ${m.project.client}`)
        .join('\n') || 'No matched projects';

      const userPrompt = GAP_ANALYSIS_USER_PROMPT
        .replace('{{GAPS}}', gapsText)
        .replace('{{COVERAGE}}', coverageText)
        .replace('{{REQUIREMENTS}}', requirements)
        .replace('{{MATCHED_PROJECTS}}', matchedProjectsText);

      try {
        aiRecommendations = await invokeClaudeJson({
          modelId: BEDROCK_MODEL_ID,
          system: GAP_ANALYSIS_SYSTEM_PROMPT,
          user: userPrompt,
          outputSchema: GapRecommendationsSchema,
          maxTokens: 2000,
          temperature: 0.2,
        });
      } catch (err) {
        console.error('Failed to get AI recommendations:', err);
      }
    }

    return apiResponse(200, {
      ok: true,
      gapAnalysis,
      aiRecommendations,
      summary: {
        overallCoverage: gapAnalysis.overallCoverage,
        totalRequirements: gapAnalysis.coverageItems.length,
        covered: gapAnalysis.coverageItems.filter(c => c.status === 'COVERED').length,
        partial: gapAnalysis.coverageItems.filter(c => c.status === 'PARTIAL').length,
        gaps: gapAnalysis.coverageItems.filter(c => c.status === 'GAP').length,
        criticalGaps: gapAnalysis.criticalGaps.length,
        matchedProjects: matches.length,
      },
    });
  } catch (error: any) {
    console.error('Error performing gap analysis:', error);

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

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware())
);