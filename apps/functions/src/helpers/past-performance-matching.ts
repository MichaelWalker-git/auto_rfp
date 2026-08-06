import type {
  ExecutiveBriefItem,
  GapAnalysis,
  PastPerformanceSection,
  PastProjectMatch,
  RequirementsSection,
} from '@auto-rfp/core';
import {
  matchProjectsToRequirements,
  performGapAnalysis,
  trackPastProjectUsage,
} from '@/helpers/past-performance';
import {
  buildSectionInputHash,
  getExecutiveBrief,
  loadSolicitationForBrief,
  markSectionComplete,
  markSectionFailed,
  markSectionInProgress,
  truncateText,
} from '@/helpers/executive-opportunity-brief';
import { getProjectById } from '@/helpers/project';
import { safeSplitAt } from '@/helpers/safe-string';
import { requireEnv } from '@/helpers/env';
import { SK_NAME } from '@/constants/common';

const MAX_SOLICITATION_CHARS = Number(requireEnv('BRIEF_MAX_SOLICITATION_CHARS', '45000'));

/** Error with an HTTP status hint so thin handlers can map it to a response. */
export class PastPerformanceMatchingError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PastPerformanceMatchingError';
    this.statusCode = statusCode;
  }
}

export interface RunPastPerformanceMatchingArgs {
  executiveBriefId: string;
  /** Known orgId (e.g. from an SQS job). When omitted it is resolved from the brief's project. */
  orgId?: string;
  topK?: number;
  force?: boolean;
  /** Pre-loaded brief to avoid an extra read (e.g. from the exec-brief worker). */
  brief?: ExecutiveBriefItem;
}

export interface RunPastPerformanceMatchingResult {
  pastPerformance: PastPerformanceSection;
  cached: boolean;
}

const resolveOrgId = async (brief: ExecutiveBriefItem, orgIdHint?: string): Promise<string> => {
  if (orgIdHint) return orgIdHint;
  if (brief.orgId) return brief.orgId;

  const project = await getProjectById(brief.projectId);
  if (!project) {
    throw new PastPerformanceMatchingError('Project not found for executive brief', 400);
  }

  const projectRec = project as Record<string, unknown>;
  const organization = projectRec.organization as { id?: string } | undefined;
  let orgId = (projectRec.orgId as string | undefined) || organization?.id;

  if (!orgId && projectRec[SK_NAME]) {
    // SK format is "<orgId>#<projectId>"
    orgId = safeSplitAt(projectRec[SK_NAME], '#', 0);
  }

  if (!orgId) {
    throw new PastPerformanceMatchingError('Organization ID not found for project', 400);
  }

  return orgId;
};

const extractRequirements = (brief: ExecutiveBriefItem): string[] => {
  const requirementsData = brief.sections?.requirements?.data as RequirementsSection | null | undefined;
  const requirements: string[] = [];

  for (const req of requirementsData?.requirements ?? []) {
    if (req?.requirement) requirements.push(req.requirement);
  }

  // If no requirements extracted, fall back to the solicitation summary
  if (requirements.length === 0) {
    const summaryData = brief.sections?.summary?.data as { summary?: string } | null | undefined;
    if (summaryData?.summary) requirements.push(summaryData.summary);
  }

  return requirements;
};

export const generateNarrativeSummary = (
  matches: PastProjectMatch[],
  gapAnalysis: GapAnalysis | null | undefined,
): string => {
  const parts: string[] = [];

  const meaningfulMatches = matches.filter((m) => m.relevanceScore >= 30);

  if (meaningfulMatches.length === 0) {
    parts.push('No relevant past performance projects were found matching this opportunity.');
    if (matches.length > 0) {
      parts.push(`${matches.length} project(s) were reviewed but none demonstrated meaningful relevance.`);
    }
    parts.push('Consider adding past projects with relevant experience or exploring teaming arrangements.');
  } else {
    parts.push(`Found ${meaningfulMatches.length} relevant past performance project(s).`);
    const topMatch = meaningfulMatches[0];
    parts.push(
      `The strongest match is "${topMatch.project.title}" with a ${topMatch.relevanceScore}% relevance score.`,
    );
  }

  if (gapAnalysis) {
    parts.push(`Overall past performance coverage: ${gapAnalysis.overallCoverage}%.`);
    if (gapAnalysis.criticalGaps.length > 0) {
      parts.push(
        `${gapAnalysis.criticalGaps.length} critical gap(s) identified that may require teaming or subcontracting.`,
      );
    }
  }

  return parts.join(' ');
};

/**
 * Run past-performance project matching for an executive brief and persist the
 * result as the brief's `pastPerformance` section.
 *
 * Idempotent: when the section is already COMPLETE with data and `force` is not
 * set, the cached data is returned without re-running the matching.
 *
 * Used by both the UI-triggered `pastperf/match-projects` endpoint and the
 * exec-brief SQS worker (which runs it before generating the scoring section).
 */
export const runPastPerformanceMatching = async (
  args: RunPastPerformanceMatchingArgs,
): Promise<RunPastPerformanceMatchingResult> => {
  const { executiveBriefId, topK, force } = args;

  const brief: ExecutiveBriefItem = args.brief ?? (await getExecutiveBrief(executiveBriefId));
  const orgId = await resolveOrgId(brief, args.orgId);

  // Idempotency: return cached data when the section already completed
  const existingSection = brief.sections?.pastPerformance;
  if (!force && existingSection?.status === 'COMPLETE' && existingSection?.data) {
    return { pastPerformance: existingSection.data, cached: true };
  }

  const inputHash = buildSectionInputHash({
    executiveBriefId,
    section: 'pastPerformance',
    opportunityId: brief.opportunityId,
    allTextKeys: brief.allTextKeys,
  });

  await markSectionInProgress({
    executiveBriefId,
    section: 'pastPerformance',
    inputHash,
  });

  try {
    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const requirements = extractRequirements(brief);

    const matches = await matchProjectsToRequirements(orgId, requirements, solicitationText, topK || 5);

    // Track usage of matched projects (best-effort inside the helper)
    for (const match of matches) {
      await trackPastProjectUsage(orgId, match.project.projectId, executiveBriefId);
    }

    const requirementsData = brief.sections?.requirements?.data as RequirementsSection | null | undefined;
    const requirementsWithCategory =
      requirementsData?.requirements
        ?.filter((r): r is typeof r & { requirement: string } => Boolean(r?.requirement))
        .map((r) => ({
          category: r.category ?? undefined,
          requirement: r.requirement,
        })) || requirements.map((r) => ({ requirement: r }));

    const gapAnalysis = await performGapAnalysis(orgId, requirementsWithCategory, matches);

    // Calculate confidence score based on coverage (guard against NaN)
    const coverage =
      typeof gapAnalysis.overallCoverage === 'number' && !isNaN(gapAnalysis.overallCoverage)
        ? gapAnalysis.overallCoverage
        : 0;
    const confidenceScore = Math.round(
      coverage * 0.7 + (matches.length > 0 ? 20 : 0) + (gapAnalysis.criticalGaps.length === 0 ? 10 : 0),
    );

    const pastPerformanceData: PastPerformanceSection = {
      topMatches: matches,
      gapAnalysis,
      narrativeSummary: generateNarrativeSummary(matches, gapAnalysis),
      confidenceScore,
      evidence: [],
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'pastPerformance',
      data: pastPerformanceData,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    return { pastPerformance: pastPerformanceData, cached: false };
  } catch (processingError) {
    await markSectionFailed({
      executiveBriefId,
      section: 'pastPerformance',
      error: processingError,
    });
    throw processingError;
  }
};

/**
 * Ensure the brief's past-performance section is populated before scoring.
 * Returns the section data, or `undefined` when matching fails — scoring
 * proceeds without past-performance context in that case (non-blocking).
 */
export const ensurePastPerformanceForScoring = async (args: {
  executiveBriefId: string;
  orgId: string;
  brief: ExecutiveBriefItem;
}): Promise<PastPerformanceSection | undefined> => {
  const existing = args.brief.sections?.pastPerformance;
  if (existing?.status === 'COMPLETE' && existing?.data) return existing.data;

  try {
    const { pastPerformance } = await runPastPerformanceMatching(args);
    return pastPerformance;
  } catch (err) {
    console.warn(
      'ensurePastPerformanceForScoring: matching failed (non-blocking for scoring):',
      (err as Error)?.message,
    );
    return undefined;
  }
};
