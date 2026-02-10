import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '../sentry-lambda';
import { MatchProjectsRequestSchema, type PastPerformanceSection } from '@auto-rfp/shared';
import type { ExecutiveBriefItem } from '@auto-rfp/shared';
import { 
  matchProjectsToRequirements, 
  performGapAnalysis 
} from '../helpers/past-performance';
import {
  getExecutiveBrief,
  loadSolicitationForBrief,
  truncateText,
  markSectionInProgress,
  markSectionComplete,
  markSectionFailed,
  buildSectionInputHash,
} from '../helpers/executive-opportunity-brief';
import { getProjectById } from '../helpers/project';
import { safeSplitAt } from '../helpers/safe-string';
import { apiResponse } from '../helpers/api';
import { requireEnv } from '../helpers/env';
import { SK_NAME } from '../constants/common';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '../middleware/rbac-middleware';

const MAX_SOLICITATION_CHARS = Number(requireEnv('BRIEF_MAX_SOLICITATION_CHARS', '45000'));

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    console.log('match-projects request body:', JSON.stringify(body));
    
    const { executiveBriefId, topK, force } = MatchProjectsRequestSchema.parse(body);
    console.log('Parsed params - executiveBriefId:', executiveBriefId, 'topK:', topK, 'force:', force);

    // Load the executive brief
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    
    // Get orgId from the project (brief doesn't store orgId directly)
    const project = await getProjectById(brief.projectId);
    if (!project) {
      return apiResponse(400, {
        ok: false,
        error: 'Project not found for executive brief',
      });
    }
    
    // Extract orgId from project - try multiple sources
    // 1. Direct orgId property
    // 2. From organization object
    // 3. From SK (format: "<orgId>#<projectId>")
    let orgId = project.orgId || (project as any).organization?.id;
    
    if (!orgId && project[SK_NAME]) {
      // SK format is "<orgId>#<projectId>"
      orgId = safeSplitAt(project[SK_NAME], '#', 0);
    }
    
    if (!orgId) {
      console.error('Could not extract orgId from project:', JSON.stringify(project, null, 2));
      return apiResponse(400, {
        ok: false,
        error: 'Organization ID not found for project',
      });
    }

    // Check if already complete and not forcing
    const existingSection = (brief.sections as any)?.pastPerformance;
    console.log('Existing section status:', existingSection?.status, 'force:', force);
    
    if (!force && existingSection?.status === 'COMPLETE' && existingSection?.data) {
      console.log('Returning cached data (force is false/undefined)');
      return apiResponse(200, {
        ok: true,
        cached: true,
        pastPerformance: existingSection.data,
      });
    }
    
    console.log('Proceeding with fresh matching (force:', force, ')');

    // Build input hash for idempotency
    const inputHash = buildSectionInputHash({
      executiveBriefId,
      section: 'pastPerformance' as any,
      opportunityId: brief.opportunityId,
      textKey: brief.textKey,
    });

    // Mark section as in progress
    await markSectionInProgress({
      executiveBriefId,
      section: 'pastPerformance' as any,
      inputHash,
    });

    try {
      // Load solicitation text
      const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
      const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

      // Extract requirements from the brief if available
      const requirementsSection = (brief.sections as any)?.requirements?.data;
      const requirements: string[] = [];

      if (requirementsSection?.requirements) {
        for (const req of requirementsSection.requirements) {
          if (req.requirement) {
            requirements.push(req.requirement);
          }
        }
      }

      // If no requirements extracted, use solicitation summary
      if (requirements.length === 0) {
        const summarySection = (brief.sections as any)?.summary?.data;
        if (summarySection?.summary) {
          requirements.push(summarySection.summary);
        }
      }

      // Match past projects to requirements
      const matches = await matchProjectsToRequirements(
        orgId,
        requirements,
        solicitationText,
        topK || 5
      );

      // Perform gap analysis
      const requirementsWithCategory = requirementsSection?.requirements?.map((r: any) => ({
        category: r.category,
        requirement: r.requirement,
      })) || requirements.map(r => ({ requirement: r }));

      const gapAnalysis = await performGapAnalysis(orgId, requirementsWithCategory, matches);

      // Calculate confidence score based on coverage
      // Ensure we don't get NaN by providing defaults
      const coverage = typeof gapAnalysis.overallCoverage === 'number' && !isNaN(gapAnalysis.overallCoverage) 
        ? gapAnalysis.overallCoverage 
        : 0;
      const confidenceScore = Math.round(
        (coverage * 0.7) + 
        (matches.length > 0 ? 20 : 0) +
        (gapAnalysis.criticalGaps.length === 0 ? 10 : 0)
      );

      // Build the past performance section
      const pastPerformanceData: PastPerformanceSection = {
        topMatches: matches,
        gapAnalysis,
        narrativeSummary: generateNarrativeSummary(matches, gapAnalysis),
        confidenceScore,
        evidence: [],
      };

      // Mark section as complete
      await markSectionComplete({
        executiveBriefId,
        section: 'pastPerformance' as any,
        data: pastPerformanceData,
        topLevelPatch: { status: 'IN_PROGRESS' },
      });

      return apiResponse(200, {
        ok: true,
        pastPerformance: pastPerformanceData,
      });
    } catch (processingError) {
      // Mark section as failed
      await markSectionFailed({
        executiveBriefId,
        section: 'pastPerformance' as any,
        error: processingError,
      });
      throw processingError;
    }
  } catch (error: any) {
    console.error('Error matching past projects:', error);

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

function generateNarrativeSummary(
  matches: any[],
  gapAnalysis: any
): string {
  const parts: string[] = [];

  if (matches.length === 0) {
    parts.push('No relevant past performance projects were found in the database.');
    parts.push('Consider adding past projects or exploring teaming arrangements.');
  } else {
    parts.push(`Found ${matches.length} relevant past performance project(s).`);
    
    const topMatch = matches[0];
    if (topMatch) {
      parts.push(`The strongest match is "${topMatch.project.title}" with a ${topMatch.relevanceScore}% relevance score.`);
    }
  }

  if (gapAnalysis) {
    parts.push(`Overall past performance coverage: ${gapAnalysis.overallCoverage}%.`);
    
    if (gapAnalysis.criticalGaps.length > 0) {
      parts.push(`${gapAnalysis.criticalGaps.length} critical gap(s) identified that may require teaming or subcontracting.`);
    }
  }

  return parts.join(' ');
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware())
);