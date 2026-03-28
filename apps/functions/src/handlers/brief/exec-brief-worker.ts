import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { z, ZodError } from 'zod';
import { Sentry, withSentryLambda } from '@/sentry-lambda';
import {
  ContactsSectionSchema,
  DeadlinesSectionSchema,
  type ExecutiveBriefItem,
  PricingSectionSchema,
  QuickSummarySchema,
  RequirementsSectionSchema,
  RisksSectionSchema,
  ScoringSectionSchema
} from '@auto-rfp/core';
import {
  getSummarySystemPrompt,
  useContactsSystemPrompt,
  useContactsUserPrompt,
  useDeadlineSystemPrompt,
  useDeadlineUserPrompt,
  useRequirementsSystemPrompt,
  useRequirementsUserPrompt,
  useRiskSystemPrompt,
  useRiskUserPrompt,
  useScoringSystemPrompt,
  useScoringUserPrompt,
  useSummaryUserPrompt
} from '@/constants/prompt';

import {
  buildSectionInputHash,
  computeOverallStatus,
  getExecutiveBrief,
  invokeClaudeJson,
  loadSolicitationForBrief,
  markSectionComplete,
  markSectionFailed,
  markSectionInProgress,
  queryCompanyKnowledgeBase,
  sanitizeSummaryResponse,
  truncateText,
} from '@/helpers/executive-opportunity-brief';
import { syncRequiredDocumentsToCustomTypes } from '@/helpers/custom-document-types';
import type { RequiredOutputDocument } from '@auto-rfp/core';
import { enqueueGoogleDriveSync } from '@/helpers/google-drive-queue';
import { getProjectById } from '@/helpers/project';
import { requireEnv } from '@/helpers/env';
import { loadTextFromS3 } from '@/helpers/s3';
import { storeDeadlinesSeparately } from '@/helpers/deadlines';
import { invokeClaudeWithTools } from '@/helpers/bedrock-tool-loop';
import { BRIEF_TOOLS, executeBriefTool } from '@/helpers/brief-tools';
import { PRICING_TOOLS, executePricingTool } from '@/helpers/pricing-tools';
import { usePricingSystemPrompt, usePricingUserPrompt } from '@/constants/pricing-prompts';
import { onBriefScoringComplete } from '@/helpers/opportunity-stage';

const JobSchema = z.object({
  orgId: z.string().min(1),
  executiveBriefId: z.string().min(1),
  section: z.enum(['summary', 'deadlines', 'requirements', 'contacts', 'risks', 'pricing', 'scoring']),
  topK: z.number().int().min(1).max(100).optional(),
  inputHash: z.string().min(1),
  retryCount: z.number().int().min(0).optional().default(0),
});

type Job = z.infer<typeof JobSchema>;
type Section = Job['section'];

/** Weighted scoring criteria – must match the prompt instructions */
const SCORING_WEIGHTS: Record<string, number> = {
  TECHNICAL_FIT: 0.20,
  PAST_PERFORMANCE_RELEVANCE: 0.30,
  PRICING_POSITION: 0.15,
  STRATEGIC_ALIGNMENT: 0.25,
  INCUMBENT_RISK: 0.10,
};

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(requireEnv('BRIEF_MAX_SOLICITATION_CHARS', '45000'));
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── KB Primer ────────────────────────────────────────────────────────────────

/**
 * Load a small KB primer (top N chunks) to give Claude initial context.
 * Claude uses tools to pull deeper, more specific KB data as needed.
 * Replaces the 20-line inline KB loading block repeated in each section handler.
 */
const loadKbPrimer = async (
  orgId: string,
  solicitationText: string,
  topK = 3,
): Promise<string> => {
  try {
    const kbMatches = await queryCompanyKnowledgeBase(orgId, solicitationText, topK * 2);
    const kbParts = await Promise.all(
      (kbMatches ?? []).slice(0, topK).map(async (m, i) => {
        const header = `#${i + 1} score=${m.score}${m.source?.chunkKey ? ` chunkKey=${m.source.chunkKey}` : ''}`;
        const text = m.source?.chunkKey
          ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
          : '';
        return [header, text].filter(Boolean).join('\n');
      }),
    );
    return kbParts.join('\n\n');
  } catch (err) {
    console.warn('loadKbPrimer error:', (err as Error)?.message);
    return '';
  }
};

// ─── Summary Schema with Sanitization ─────────────────────────────────────────

/**
 * Wraps QuickSummarySchema with pre-sanitization so that `invokeClaudeWithTools`
 * (which calls `schema.parse()` internally) automatically sanitizes the raw
 * Bedrock response before Zod validation.
 */
const SanitizedQuickSummarySchema = {
  parse: (data: unknown) => {
    const sanitized = sanitizeSummaryResponse(data);
    return QuickSummarySchema.parse(sanitized);
  },
};

/**
 * Minimal fallback schema for summary — accepts any response with a non-empty
 * summary string and fills in defaults for missing optional fields.
 */
const MinimalSummarySchema = z.object({
  summary: z.preprocess(
    (v) => {
      if (typeof v === 'string') return v.trim();
      if (typeof v === 'object' && v !== null) return JSON.stringify(v);
      return String(v || '');
    },
    z.string().min(1),
  ),
}).passthrough();

// ─── Section Handlers ─────────────────────────────────────────────────────────

async function runSummary(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const projectId = brief.projectId;
    const opportunityId = brief.opportunityId as string;

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'summary',
        opportunityId,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'summary', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);
    const kbPrimer = await loadKbPrimer(orgId, solicitationText, 3);

    let data: unknown;

    try {
      // Primary attempt: use sanitized schema wrapper
      data = await invokeClaudeWithTools({
        modelId: BEDROCK_MODEL_ID,
        system: await getSummarySystemPrompt(orgId),
        user: await useSummaryUserPrompt(
          orgId,
          solicitationText,
          kbPrimer,
          JSON.stringify(QuickSummarySchema.shape, null, 2),
        ),
        tools: BRIEF_TOOLS,
        toolExecutor: (toolName, toolInput, toolUseId) =>
          executeBriefTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
        outputSchema: SanitizedQuickSummarySchema,
        maxTokens: 1200,
        temperature: 0.2,
        maxToolRounds: 2,
      });
    } catch (primaryErr) {
      // ── Comprehensive error logging for ZodError ──
      if (primaryErr instanceof ZodError) {
        console.error('[SUMMARY] Zod validation failed:', JSON.stringify({
          zodErrors: primaryErr.format(),
          zodIssues: primaryErr.issues,
          executiveBriefId,
          orgId,
        }));

        Sentry.captureException(new Error('Summary generation ZodError'), {
          extra: {
            zodErrors: primaryErr.issues,
            executiveBriefId,
            orgId,
          },
        });
      } else {
        console.error('[SUMMARY] Primary invocation failed:', (primaryErr as Error)?.message);
      }

      // ── Fallback: retry with minimal schema ──
      console.warn('[SUMMARY] Retrying with minimal fallback schema...');
      try {
        const fallbackData = await invokeClaudeWithTools({
          modelId: BEDROCK_MODEL_ID,
          system: await getSummarySystemPrompt(orgId),
          user: await useSummaryUserPrompt(
            orgId,
            solicitationText,
            kbPrimer,
            JSON.stringify(QuickSummarySchema.shape, null, 2),
          ),
          tools: BRIEF_TOOLS,
          toolExecutor: (toolName, toolInput, toolUseId) =>
            executeBriefTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
          outputSchema: MinimalSummarySchema,
          maxTokens: 1200,
          temperature: 0.1,
          maxToolRounds: 1,
        });

        console.warn('[SUMMARY] Fallback schema succeeded — missing optional fields will use defaults');
        data = {
          ...fallbackData,
          contractType: (fallbackData as Record<string, unknown>).contractType ?? 'UNKNOWN',
          setAside: (fallbackData as Record<string, unknown>).setAside ?? 'UNKNOWN',
        };
      } catch (fallbackErr) {
        console.error('[SUMMARY] Fallback also failed:', (fallbackErr as Error)?.message);
        Sentry.captureException(new Error('Summary generation fallback failed'), {
          extra: {
            primaryError: (primaryErr as Error)?.message,
            fallbackError: (fallbackErr as Error)?.message,
            executiveBriefId,
            orgId,
          },
        });
        // Re-throw the original error for proper failure handling
        throw primaryErr;
      }
    }

    await markSectionComplete({
      executiveBriefId,
      section: 'summary',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'summary', error: err });
    throw err;
  }
}

async function runDeadlines(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'deadlines',
        opportunityId: brief.opportunityId as string,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'deadlines', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    // Deadlines: pure extraction from solicitation — no tools needed
    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useDeadlineSystemPrompt(orgId),
      user: await useDeadlineUserPrompt(orgId, solicitationText),
      outputSchema: DeadlinesSectionSchema,
      maxTokens: 4000,
      temperature: 0.1,
    });

    const normalized = {
      ...data,
      hasSubmissionDeadline:
        Boolean((data as Record<string, unknown>).hasSubmissionDeadline) || Boolean((data as Record<string, unknown>).submissionDeadlineIso),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'deadlines',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    await storeDeadlinesSeparately(executiveBriefId, brief.projectId, normalized, brief.opportunityId);
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'deadlines', error: err });
    throw err;
  }
}

async function runRequirements(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  if (!orgId) throw new Error('orgId is missing in SQS job payload');

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const projectId = brief.projectId;
    const opportunityId = brief.opportunityId as string;

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'requirements',
        opportunityId,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'requirements', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);
    const kbPrimer = await loadKbPrimer(orgId, solicitationText, 3);

    const data = await invokeClaudeWithTools({
      modelId: BEDROCK_MODEL_ID,
      system: await useRequirementsSystemPrompt(orgId),
      user: await useRequirementsUserPrompt(orgId, solicitationText, kbPrimer),
      tools: BRIEF_TOOLS,
      toolExecutor: (toolName, toolInput, toolUseId) =>
        executeBriefTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
      outputSchema: RequirementsSectionSchema,
      maxTokens: 8000,
      temperature: 0.2,
      maxToolRounds: 3,
    });

    await markSectionComplete({
      executiveBriefId,
      section: 'requirements',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    // Sync new document types to DynamoDB (non-blocking)
    const dataRec = data as unknown as Record<string, unknown>;
    const submissionCompliance = dataRec?.submissionCompliance as Record<string, unknown> | undefined;
    const requiredDocs = submissionCompliance?.requiredDocuments as RequiredOutputDocument[] | undefined;
    if (requiredDocs?.length && orgId) {
      syncRequiredDocumentsToCustomTypes(orgId, requiredDocs).catch(err =>
        console.warn('syncRequiredDocumentsToCustomTypes failed (non-blocking):', (err as Error)?.message),
      );
    }
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'requirements', error: err });
    throw err;
  }
}

async function runContacts(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  if (!orgId) throw new Error('orgId is missing in SQS job payload');

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'contacts',
        opportunityId: brief.opportunityId as string,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'contacts', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    // Contacts: pure extraction from solicitation — no tools needed
    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useContactsSystemPrompt(orgId),
      user: await useContactsUserPrompt(orgId, solicitationText),
      outputSchema: ContactsSectionSchema,
      maxTokens: 1400,
      temperature: 0.1,
    });

    const foundRoles = (data.contacts ?? []).map((c: Record<string, unknown>) => c.role);
    const dataContactsRec = data as unknown as Record<string, unknown>;
    const existingMissingRoles = dataContactsRec.missingRecommendedRoles as string[] | undefined;
    const normalized = {
      ...data,
      missingRecommendedRoles: existingMissingRoles?.length
        ? existingMissingRoles
        : computeMissingRoles(foundRoles as string[]),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'contacts',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'contacts', error: err });
    throw err;
  }
}

async function runRisks(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const projectId = brief.projectId;
    const opportunityId = brief.opportunityId as string;

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'risks',
        opportunityId,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'risks', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);
    const kbPrimer = await loadKbPrimer(orgId, solicitationText, 2);

    const data = await invokeClaudeWithTools({
      modelId: BEDROCK_MODEL_ID,
      system: await useRiskSystemPrompt(orgId),
      user: await useRiskUserPrompt(orgId, solicitationText),
      tools: BRIEF_TOOLS,
      toolExecutor: (toolName, toolInput, toolUseId) =>
        executeBriefTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
      outputSchema: RisksSectionSchema,
      maxTokens: 8000,
      temperature: 0.2,
      maxToolRounds: 2,
    });

    const normalize = (items: Record<string, unknown>[]) =>
      (items ?? []).map((r) => ({
        ...r,
        impactsScore:
          typeof r?.impactsScore === 'boolean'
            ? r.impactsScore
            : ['HIGH', 'CRITICAL'].includes(r?.severity as string),
      }));

    const dataAsRecord = data as unknown as Record<string, unknown>;
    const normalized = {
      ...data,
      risks: normalize((dataAsRecord.risks as Record<string, unknown>[] | undefined) ?? []),
      redFlags: normalize((dataAsRecord.redFlags as Record<string, unknown>[] | undefined) ?? []),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'risks',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'risks', error: err });
    throw err;
  }
}

async function runPricing(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const projectId = brief.projectId;
    const opportunityId = brief.opportunityId as string;

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'pricing',
        opportunityId,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'pricing', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);
    const kbPrimer = await loadKbPrimer(orgId, solicitationText, 3);

    // Get requirements and summary sections for context
    const briefSections = brief.sections as Record<string, { data?: Record<string, unknown> }>;
    const requirementsData = briefSections?.requirements?.data;
    const summaryData = briefSections?.summary?.data;

    // Extract key pricing anchors from summary (estimatedValueUsd, contractType, naics, periodOfPerformance)
    const pricingAnchors = summaryData ? {
      estimatedValueUsd: summaryData.estimatedValueUsd,
      contractType: summaryData.contractType,
      naics: summaryData.naics,
      periodOfPerformance: summaryData.periodOfPerformance,
      agency: summaryData.agency,
      setAside: summaryData.setAside,
    } : undefined;

    const data = await invokeClaudeWithTools({
      modelId: BEDROCK_MODEL_ID,
      system: await usePricingSystemPrompt(orgId),
      user: await usePricingUserPrompt(
        orgId,
        solicitationText,
        requirementsData ? JSON.stringify(requirementsData) : '',
        kbPrimer,
        pricingAnchors ? JSON.stringify(pricingAnchors) : '',
      ),
      tools: [...BRIEF_TOOLS, ...PRICING_TOOLS],
      toolExecutor: (toolName, toolInput, toolUseId) =>
        executePricingTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
      outputSchema: PricingSectionSchema,
      maxTokens: 6000,
      temperature: 0.2,
      maxToolRounds: 5,
    });

    await markSectionComplete({
      executiveBriefId,
      section: 'pricing',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'pricing', error: err });
    throw err;
  }
}

async function runScoring(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  if (!orgId) throw new Error('orgId is missing in SQS job payload');

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const projectId = brief.projectId;
    const opportunityId = brief.opportunityId as string;

    const prereq = scoringPrereqsComplete(brief);
    if (!prereq.ok) {
      const missing = (prereq as { ok: false; missing: string[] }).missing;
      throw new Error(`All fields should be ready before calling scoring. Missing: ${missing.join(', ')}`);
    }

    const sections = brief.sections as Record<string, { data?: Record<string, unknown> }>;
    const summaryData = sections?.summary?.data;
    const deadlinesData = sections?.deadlines?.data;
    const requirementsData = sections?.requirements?.data;
    const contactsData = sections?.contacts?.data;
    const risksData = sections?.risks?.data;

    if (!summaryData || !deadlinesData || !requirementsData || !contactsData || !risksData) {
      const missingData: string[] = [];
      if (!summaryData) missingData.push('summary.data');
      if (!deadlinesData) missingData.push('deadlines.data');
      if (!requirementsData) missingData.push('requirements.data');
      if (!contactsData) missingData.push('contacts.data');
      if (!risksData) missingData.push('risks.data');
      throw new Error(`Section data missing for scoring: ${missingData.join(', ')}`);
    }

    const pastPerformanceData = sections?.pastPerformance?.data;
    const pricingData = sections?.pricing?.data;

    // Also try to load actual cost estimate data from the pricing module
    let pricingContext = pricingData ? JSON.stringify(pricingData) : undefined;
    if (!pricingContext) {
      try {
        const { getCostEstimateByOpportunity, analyzePricingForBid } = await import('@/helpers/pricing');
        const estimate = await getCostEstimateByOpportunity(orgId, projectId, opportunityId);
        if (estimate) {
          const bidAnalysis = analyzePricingForBid(estimate);
          pricingContext = JSON.stringify({
            source: 'pricing_module',
            totalPrice: estimate.totalPrice,
            strategy: estimate.strategy,
            margin: estimate.margin,
            competitivePosition: bidAnalysis.competitivePosition,
            priceConfidence: bidAnalysis.priceConfidence,
            marginAdequacy: bidAnalysis.marginAdequacy,
            pricingRisks: bidAnalysis.pricingRisks,
            competitiveAdvantages: bidAnalysis.competitiveAdvantages,
            scoringImpact: bidAnalysis.scoringImpact,
          });
        }
      } catch (pricingErr) {
        console.warn('Failed to load pricing module data for scoring (non-blocking):', (pricingErr as Error)?.message);
      }
    }

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'scoring',
        opportunityId,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'scoring', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);
    const kbPrimer = await loadKbPrimer(orgId, solicitationText, 3);

    const data = await invokeClaudeWithTools({
      modelId: BEDROCK_MODEL_ID,
      system: await useScoringSystemPrompt(orgId),
      user: await useScoringUserPrompt(
        orgId,
        solicitationText,
        JSON.stringify(summaryData),
        JSON.stringify(deadlinesData),
        JSON.stringify(requirementsData),
        JSON.stringify(contactsData),
        JSON.stringify(risksData),
        pastPerformanceData ? JSON.stringify(pastPerformanceData) : undefined,
        kbPrimer,
        pricingContext,
      ),
      tools: BRIEF_TOOLS,
      toolExecutor: (toolName, toolInput, toolUseId) =>
        executeBriefTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
      outputSchema: ScoringSectionSchema,
      maxTokens: 5000,
      temperature: 0.2,
      maxToolRounds: 2,
    });

    const computedComposite = weightedCompositeScore((data?.criteria ?? []) as Array<{ name?: string; score?: number }>);

    const normalized = {
      ...data,
      compositeScore: computedComposite,
      decision:
        data.decision ??
        (data.recommendation === 'NO_GO'
          ? 'NO_GO'
          : data.recommendation === 'GO'
            ? 'GO'
            : 'CONDITIONAL_GO'),
      blockers: data.blockers ?? [],
      requiredActions: data.requiredActions ?? [],
      confidenceDrivers: data.confidenceDrivers ?? [],
    };

    type SectionStatus = 'FAILED' | 'IN_PROGRESS' | 'IDLE' | 'COMPLETE';
    const nextSections: Record<string, { status: SectionStatus }> = {
      ...(brief.sections as Record<string, { status: SectionStatus }>),
      scoring: { status: 'COMPLETE' as SectionStatus },
    };
    const overall = computeOverallStatus(nextSections);

    await markSectionComplete({
      executiveBriefId,
      section: 'scoring',
      data: normalized,
      topLevelPatch: {
        compositeScore: normalized.compositeScore,
        recommendation: normalized.recommendation,
        decision: normalized.decision,
        confidence: normalized.confidence,
        status: overall,
      },
    });

    // Auto-transition opportunity stage based on scoring decision (fire-and-forget)
    onBriefScoringComplete({
      orgId,
      projectId,
      oppId: opportunityId,
      decision: normalized.decision as 'GO' | 'NO_GO' | 'CONDITIONAL_GO',
      compositeScore: normalized.compositeScore,
    });

    // Google Drive Sync on GO Decision (async via SQS)
    if (normalized.decision === 'GO') {
      try {
        console.log(`GO decision detected for brief ${executiveBriefId} — enqueuing Google Drive sync`);
        const updatedBrief = await getExecutiveBrief(executiveBriefId);
        const project = await getProjectById(brief.projectId);
        const projectName = (project as Record<string, unknown>)?.name || brief.projectId;

        await enqueueGoogleDriveSync({
          orgId,
          projectId: brief.projectId,
          opportunityId,
          executiveBriefId,
          linearTicketId: updatedBrief.linearTicketId as string | undefined,
          linearTicketIdentifier: updatedBrief.linearTicketIdentifier as string | undefined,
          agencyName: summaryData?.agency as string | undefined,
          projectTitle: (summaryData?.title as string | undefined) || String(projectName),
        });
      } catch (enqueueErr) {
        console.error('Failed to enqueue Google Drive sync (non-blocking):', (enqueueErr as Error)?.message);
      }
    }
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'scoring', error: err });
    throw err;
  }
}

// ─── Section dispatcher ───────────────────────────────────────────────────────

const sectionHandlers: Record<Section, (job: Job) => Promise<void>> = {
  summary: runSummary,
  deadlines: runDeadlines,
  requirements: runRequirements,
  contacts: runContacts,
  risks: runRisks,
  pricing: runPricing,
  scoring: runScoring,
};

const runSection = async (job: Job): Promise<void> => {
  const handler = sectionHandlers[job.section];
  if (!handler) throw new Error(`No handler for section: ${job.section}`);
  await handler(job);
};

// ─── SQS Handler ─────────────────────────────────────────────────────────────

const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    const rawBody = JSON.parse(record.body);
    const job = JobSchema.parse(rawBody);
    await runSection(job);
  }

  return { batchItemFailures };
};

// ─── Utilities ────────────────────────────────────────────────────────────────

const average = (nums: number[]): number => {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

const weightedCompositeScore = (criteria: Array<{ name?: string; score?: number }>): number => {
  if (!criteria.length) return 0;

  let weightedSum = 0;
  let totalWeight = 0;
  let matched = 0;

  for (const c of criteria) {
    const score = c.score ?? 0;
    const weight = c.name ? SCORING_WEIGHTS[c.name] : undefined;
    if (weight !== undefined) {
      weightedSum += score * weight;
      totalWeight += weight;
      matched++;
    }
  }

  if (matched < criteria.length / 2 || totalWeight === 0) {
    const scores = criteria.map((c) => c.score ?? 0);
    return Math.round(average(scores) * 10) / 10;
  }

  return Math.round((weightedSum / totalWeight) * 10) / 10;
};

const computeMissingRoles = (foundRoles: string[]): string[] => {
  const recommended = [
    'CONTRACTING_OFFICER',
    'CONTRACT_SPECIALIST',
    'TECHNICAL_POC',
    'SMALL_BUSINESS_SPECIALIST',
  ] as const;

  const found = new Set(foundRoles);
  return recommended.filter((r) => !found.has(r));
};

const isSectionDataValid = (brief: ExecutiveBriefItem, section: Exclude<Section, 'scoring'>): boolean => {
  const s = (brief.sections as Record<string, { status?: string; data?: unknown }>)?.[section];
  if (!s || s.status !== 'COMPLETE') return false;
  return s.data !== null && s.data !== undefined;
};

const scoringPrereqsComplete = (brief: ExecutiveBriefItem): { ok: true } | { ok: false; missing: string[] } => {
  const prereqs: Exclude<Section, 'scoring'>[] = ['summary', 'deadlines', 'requirements', 'contacts', 'risks'];
  const missing = prereqs.filter((s) => !isSectionDataValid(brief, s));
  return missing.length ? { ok: false, missing } : { ok: true };
};

export const handler = withSentryLambda(baseHandler);
