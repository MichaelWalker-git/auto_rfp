import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { z } from 'zod';
import { withSentryLambda } from '../sentry-lambda';
import {
  ContactsSectionSchema,
  DeadlinesSectionSchema,
  type ExecutiveBriefItem,
  QuickSummarySchema,
  RequirementsSectionSchema,
  RisksSectionSchema,
  ScoringSectionSchema
} from '@auto-rfp/shared';
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
} from '../constants/prompt';

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
  truncateText,
} from '../helpers/executive-opportunity-brief';

import { requireEnv } from '../helpers/env';
import { loadTextFromS3 } from '../helpers/s3';
import { storeDeadlinesSeparately } from '../helpers/deadlines';
import { SQSClient } from '@aws-sdk/client-sqs';

const JobSchema = z.object({
  orgId: z.string().min(1),
  executiveBriefId: z.string().min(1),
  section: z.enum(['summary', 'deadlines', 'requirements', 'contacts', 'risks', 'scoring']),
  topK: z.number().int().min(1).max(100).optional(),
  inputHash: z.string().min(1),
  retryCount: z.number().int().min(0).optional().default(0),
});

type Job = z.infer<typeof JobSchema>;
type Section = Job['section'];

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(requireEnv('BRIEF_MAX_SOLICITATION_CHARS', '45000'));
const KB_TOPK_DEFAULT = Number(requireEnv('BRIEF_KB_TOPK', '20'));
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const COST_SAVING = Boolean(requireEnv('COST_SAVING', 'true'));

async function runSummary(job: Job): Promise<void> {
  const { orgId, executiveBriefId, topK, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'summary',
        questionFileId: brief.questionFileId,
        textKey: brief.textKey,
      });

    await markSectionInProgress({
      executiveBriefId,
      section: 'summary',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const kbMatches = COST_SAVING
      ? []
      : await queryCompanyKnowledgeBase(solicitationText, topK ?? KB_TOPK_DEFAULT);

    const kbParts = await Promise.all(
      (kbMatches ?? [])
        .slice(0, topK ?? KB_TOPK_DEFAULT)
        .map(async (m, i) => {
          const header = `#${i + 1} score=${m._score}${
            m._source?.documentId ? ` doc=${m._source.documentId}` : ''
          }${m._source?.chunkKey ? ` chunkKey=${m._source?.chunkKey}` : ''}`;

          const text = m._source?.chunkKey
            ? await loadTextFromS3(DOCUMENTS_BUCKET, m._source?.chunkKey)
            : '';

          return [header, text].filter(Boolean).join('\n');
        }),
    );

    const kbText = kbParts.join('\n\n');

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await getSummarySystemPrompt(orgId),
      user: await useSummaryUserPrompt(
        orgId,
        solicitationText,
        kbText,
        JSON.stringify(QuickSummarySchema.shape, null, 2),
      ),
      outputSchema: QuickSummarySchema,
      maxTokens: 1200,
      temperature: 0.2,
    });

    await markSectionComplete({
      executiveBriefId,
      section: 'summary',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({
      executiveBriefId,
      section: 'summary',
      error: err,
    });
    throw err;
  }
}

async function runDeadlines(job: Job): Promise<void> {
  const { executiveBriefId, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'deadlines',
        questionFileId: brief.questionFileId,
        textKey: brief.textKey,
      });

    await markSectionInProgress({
      executiveBriefId,
      section: 'deadlines',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useDeadlineSystemPrompt(job.orgId),
      user: await useDeadlineUserPrompt(job.orgId, solicitationText),
      outputSchema: DeadlinesSectionSchema,
      maxTokens: 4000,
      temperature: 0.1,
    });

    const normalized = {
      ...data,
      hasSubmissionDeadline:
        (data as any).hasSubmissionDeadline || Boolean((data as any).submissionDeadlineIso),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'deadlines',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    await storeDeadlinesSeparately(executiveBriefId, brief.projectId, normalized);
  } catch (err) {
    await markSectionFailed({
      executiveBriefId,
      section: 'deadlines',
      error: err,
    });
    throw err;
  }
}

async function runRequirements(job: Job): Promise<void> {
  const { orgId, executiveBriefId, topK, inputHash: inputHashFromJob } = job;

  if (!orgId) {
    throw new Error('orgId is missing in SQS job payload');
  }

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'requirements',
        questionFileId: brief.questionFileId,
        textKey: brief.textKey,
      });

    await markSectionInProgress({
      executiveBriefId,
      section: 'requirements',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const kbMatches = COST_SAVING
      ? []
      : await queryCompanyKnowledgeBase(solicitationText, topK ?? KB_TOPK_DEFAULT);

    const kbParts = await Promise.all(
      (kbMatches ?? [])
        .slice(0, topK ?? KB_TOPK_DEFAULT)
        .map(async (m, i) => {
          const header = `#${i + 1} score=${m._score}${
            m._source?.documentId ? ` doc=${m._source.documentId}` : ''
          }${m._source?.chunkKey ? ` chunkKey=${m._source?.chunkKey}` : ''}`;

          const text = m._source?.chunkKey
            ? await loadTextFromS3(DOCUMENTS_BUCKET, m._source?.chunkKey)
            : '';

          return [header, text].filter(Boolean).join('\n');
        }),
    );

    const kbText = kbParts.join('\n\n');

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useRequirementsSystemPrompt(orgId),
      user: await useRequirementsUserPrompt(orgId, solicitationText, kbText),
      outputSchema: RequirementsSectionSchema,
      maxTokens: 5000,
      temperature: 0.2,
    });

    await markSectionComplete({
      executiveBriefId,
      section: 'requirements',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({
      executiveBriefId,
      section: 'requirements',
      error: err,
    });
    throw err;
  }
}

async function runContacts(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  if (!orgId) {
    throw new Error('orgId is missing in SQS job payload');
  }

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'contacts',
        questionFileId: brief.questionFileId,
        textKey: brief.textKey,
      });

    await markSectionInProgress({
      executiveBriefId,
      section: 'contacts',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useContactsSystemPrompt(orgId),
      user: await useContactsUserPrompt(orgId, solicitationText),
      outputSchema: ContactsSectionSchema,
      maxTokens: 1400,
      temperature: 0.1,
    });

    const foundRoles = (data.contacts ?? []).map((c: any) => c.role);
    const normalized = {
      ...data,
      missingRecommendedRoles:
        (data as any).missingRecommendedRoles?.length
          ? (data as any).missingRecommendedRoles
          : (computeMissingRoles(foundRoles) as any),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'contacts',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({
      executiveBriefId,
      section: 'contacts',
      error: err,
    });
    throw err;
  }
}

async function runRisks(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'risks',
        questionFileId: brief.questionFileId,
        textKey: brief.textKey,
      });

    await markSectionInProgress({
      executiveBriefId,
      section: 'risks',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useRiskSystemPrompt(orgId),
      user: await useRiskUserPrompt(orgId, solicitationText),
      outputSchema: RisksSectionSchema,
      maxTokens: 1800,
      temperature: 0.2,
    });

    // Small normalization: if something is CRITICAL/HIGH but impactsScore missing, set it true.
    const normalize = (items: any[]) =>
      (items ?? []).map((r) => ({
        ...r,
        impactsScore:
          typeof r?.impactsScore === 'boolean'
            ? r.impactsScore
            : ['HIGH', 'CRITICAL'].includes(r?.severity),
      }));

    const normalized = {
      ...data,
      risks: normalize((data as any).risks),
      redFlags: normalize((data as any).redFlags),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'risks',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({
      executiveBriefId,
      section: 'risks',
      error: err,
    });
    throw err;
  }
}

async function runScoring(job: Job): Promise<void> {
  const { orgId, executiveBriefId, topK, inputHash: inputHashFromJob } = job;

  if (!orgId) {
    throw new Error('orgId is missing in SQS job payload');
  }

  const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

  const prereq = scoringPrereqsComplete(brief);
  if (!prereq.ok) {
    throw new Error('All fields should be ready before calling scoring');
  }
  try {
    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'scoring',
        questionFileId: brief.questionFileId,
        textKey: brief.textKey,
      });

    await markSectionInProgress({
      executiveBriefId,
      section: 'scoring',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const kbMatches = COST_SAVING
      ? []
      : await queryCompanyKnowledgeBase(solicitationText, topK ?? KB_TOPK_DEFAULT);

    const kbParts = await Promise.all(
      (kbMatches ?? [])
        .slice(0, topK ?? KB_TOPK_DEFAULT)
        .map(async (m, i) => {
          const header = `#${i + 1} score=${m._score}${
            m._source?.documentId ? ` doc=${m._source.documentId}` : ''
          }${m._source?.chunkKey ? ` chunkKey=${m._source?.chunkKey}` : ''}`;

          const text = m._source?.chunkKey
            ? await loadTextFromS3(DOCUMENTS_BUCKET, m._source?.chunkKey)
            : '';

          return [header, text].filter(Boolean).join('\n');
        }),
    );

    const kbText = kbParts.join('\n\n');

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useScoringSystemPrompt(orgId),
      user: await useScoringUserPrompt(
        orgId,
        solicitationText,
        JSON.stringify(brief.sections.summary),
        JSON.stringify(brief.sections.deadlines),
        JSON.stringify(brief.sections.requirements),
        JSON.stringify(brief.sections.contacts),
        JSON.stringify(brief.sections.risks),
        kbText,
      ),
      outputSchema: ScoringSectionSchema,
      maxTokens: 5000,
      temperature: 0.2,
    });

    const scores = data?.criteria?.map((c) => c.score || 0);
    const computedComposite = Math.round(average(scores || []) * 10) / 10;

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

    // scoring completion may update overall status
    const nextSections: any = {
      ...brief.sections,
      scoring: { ...(brief.sections as any).scoring, status: 'COMPLETE' },
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
  } catch (err) {
    await markSectionFailed({
      executiveBriefId,
      section: 'scoring',
      error: err,
    });
    throw err;
  }
}

const sectionHandlers: Record<Section, (job: Job) => Promise<void>> = {
  summary: runSummary,
  deadlines: runDeadlines,
  requirements: runRequirements,
  contacts: runContacts,
  risks: runRisks,
  scoring: runScoring,
};

async function runSection(job: Job): Promise<void> {
  const handler = sectionHandlers[job.section];
  if (!handler) {
    throw new Error(`No handler for section: ${job.section}`);
  }
  await handler(job);
}

const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      const job = JobSchema.parse(JSON.parse(record.body));
      await runSection(job);
    } catch (err) {
      console.error('exec-brief-worker error:', err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function computeMissingRoles(foundRoles: string[]): string[] {
  const recommended = [
    'CONTRACTING_OFFICER',
    'CONTRACT_SPECIALIST',
    'TECHNICAL_POC',
    'SMALL_BUSINESS_SPECIALIST',
  ] as const;

  const found = new Set(foundRoles);
  return recommended.filter((r) => !found.has(r));
}

function isSectionComplete(brief: ExecutiveBriefItem, section: Exclude<Section, 'scoring'>): boolean {
  const s = (brief.sections as any)?.[section];
  return s?.status === 'COMPLETE';
}

function scoringPrereqsComplete(brief: ExecutiveBriefItem): { ok: true } | { ok: false; missing: string[] } {
  const prereqs: Exclude<Section, 'scoring'>[] = ['summary', 'deadlines', 'requirements', 'contacts', 'risks'];
  const missing = prereqs.filter((s) => !isSectionComplete(brief, s));
  return missing.length ? { ok: false, missing } : { ok: true };
}

export const handler = withSentryLambda(baseHandler);
