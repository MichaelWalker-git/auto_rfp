/**
 * related-rfp.ts — helpers for RELATED RFP link records (HOR-2610).
 *
 * SK builders (pure), DynamoDB helpers (wrapping @/helpers/db), and the
 * client-side ranking used to score an agency's past RFPs against the current
 * opportunity.
 */

import { randomUUID } from 'crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createItem, deleteItem, queryBySkPrefix } from '@/helpers/db';
import { findOpportunityBySourceId } from '@/helpers/opportunity';
import {
  RELATED_RFP_PK,
  RELATED_RFP_SUPPRESSION_PK,
  RELATED_MATCH_THRESHOLD,
  MAX_AUTO_RELATED,
} from '@/constants/related-rfp';
import type {
  RelatedRfpDBItem,
  RelatedRfpItem,
  RelatedRfpCreateRequest,
  RelatedRfpSuppressionDBItem,
  HigherGovOpportunitySearchResult,
} from '@auto-rfp/core';

// ─── SK builders (pure) ────────────────────────────────────────────────────────

export const buildRelatedRfpSk = (
  orgId: string,
  projectId: string,
  oppId: string,
  relatedOppKey: string,
): string => `${orgId}#${projectId}#${oppId}#${relatedOppKey}`;

export const buildRelatedRfpSkPrefix = (
  orgId: string,
  projectId: string,
  oppId: string,
): string => `${orgId}#${projectId}#${oppId}`;

// ─── DB helpers (wrap @/helpers/db) ─────────────────────────────────────────────

export const listRelatedRfps = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<RelatedRfpDBItem[]> =>
  queryBySkPrefix<RelatedRfpDBItem>(RELATED_RFP_PK, buildRelatedRfpSkPrefix(orgId, projectId, oppId));

export const getRelatedRfp = async (
  orgId: string,
  projectId: string,
  oppId: string,
  relatedOppKey: string,
): Promise<RelatedRfpDBItem | undefined> => {
  const all = await listRelatedRfps(orgId, projectId, oppId);
  return all.find((r) => r.relatedOppKey === relatedOppKey);
};

export const createRelatedRfp = async (
  dto: RelatedRfpCreateRequest & {
    linkedOpportunityId?: string | null;
    createdBy?: string;
    createdByName?: string;
  },
): Promise<RelatedRfpItem> => {
  const { orgId, projectId, oppId, relatedOppKey } = dto;
  const item = await createItem<RelatedRfpDBItem>(
    RELATED_RFP_PK,
    buildRelatedRfpSk(orgId, projectId, oppId, relatedOppKey),
    {
      id: randomUUID(),
      orgId,
      projectId,
      oppId,
      relatedOppKey,
      title: dto.title,
      organizationName: dto.organizationName ?? null,
      postedDateIso: dto.postedDateIso ?? null,
      dueDateIso: dto.dueDateIso ?? null,
      sourceUrl: dto.sourceUrl ?? null,
      matchScore: dto.matchScore ?? null,
      origin: dto.origin ?? 'MANUAL',
      linkedOpportunityId: dto.linkedOpportunityId ?? null,
      ...(dto.createdBy ? { createdBy: dto.createdBy } : {}),
      ...(dto.createdByName ? { createdByName: dto.createdByName } : {}),
    },
  );
  const { partition_key, sort_key, ...rest } = item;
  return rest;
};

export const deleteRelatedRfp = async (
  orgId: string,
  projectId: string,
  oppId: string,
  relatedOppKey: string,
): Promise<void> => {
  await deleteItem(RELATED_RFP_PK, buildRelatedRfpSk(orgId, projectId, oppId, relatedOppKey));
};

/** Refresh support — remove ONLY AUTO links, leaving MANUAL adds intact. */
export const deleteAutoRelatedRfps = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<void> => {
  const existing = await listRelatedRfps(orgId, projectId, oppId);
  await Promise.all(
    existing
      .filter((r) => r.origin === 'AUTO')
      .map((r) => deleteRelatedRfp(orgId, projectId, oppId, r.relatedOppKey)),
  );
};

// ─── Suppression tombstones ─────────────────────────────────────────────────

export const addSuppression = async (
  orgId: string,
  projectId: string,
  oppId: string,
  relatedOppKey: string,
  createdBy?: string,
): Promise<void> => {
  await createItem<RelatedRfpSuppressionDBItem>(
    RELATED_RFP_SUPPRESSION_PK,
    buildRelatedRfpSk(orgId, projectId, oppId, relatedOppKey),
    {
      orgId,
      projectId,
      oppId,
      relatedOppKey,
      ...(createdBy ? { createdBy } : {}),
    },
  );
};

export const listSuppressedOppKeys = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<Set<string>> => {
  const rows = await queryBySkPrefix<RelatedRfpSuppressionDBItem>(
    RELATED_RFP_SUPPRESSION_PK,
    buildRelatedRfpSkPrefix(orgId, projectId, oppId),
  );
  return new Set(rows.map((r) => r.relatedOppKey));
};

// ─── Async trigger ─────────────────────────────────────────────────────────────

const lambdaClient = new LambdaClient({});

/**
 * Fire-and-forget kick of the find-related-rfps worker. Never throws — a failed
 * trigger must NOT block the import that called it (auto-discovery is best-effort
 * and can be re-run via the manual refresh route).
 */
export const triggerRelatedRfpDiscovery = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<void> => {
  const fnName = process.env.FIND_RELATED_RFPS_FUNCTION_NAME;
  if (!fnName) return;
  try {
    await lambdaClient.send(new InvokeCommand({
      FunctionName: fnName,
      InvocationType: 'Event', // fire-and-forget
      Payload: Buffer.from(JSON.stringify({ orgId, projectId, oppId })),
    }));
  } catch (err) {
    console.warn('[triggerRelatedRfpDiscovery] invoke failed:', (err as Error)?.message);
  }
};

// ─── Cross-link dedup ─────────────────────────────────────────────────────────

/**
 * If a related RFP is ALREADY imported in this org, return the in-app
 * OpportunityItem.oppId to deep-link to (matched by higherGovOppKey, falling back
 * to noticeId/source_id). Returns null when it is not imported.
 */
export const resolveLinkedOpportunityId = async (
  orgId: string,
  relatedOppKey: string,
  sourceId?: string | null,
): Promise<string | null> => {
  const existing =
    (await findOpportunityBySourceId({ orgId, higherGovOppKey: relatedOppKey })) ??
    (sourceId ? await findOpportunityBySourceId({ orgId, noticeId: sourceId }) : undefined);
  return existing?.oppId ?? null;
};

// ─── Ranking ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'of', 'to', 'a', 'an', 'in', 'on',
  'rfp', 'rfq', 'services', 'service', 'contract', 'solicitation',
]);

const tokenize = (s?: string | null): Set<string> =>
  new Set((s ?? '').toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((t) => !STOPWORDS.has(t)) ?? []);

/**
 * Relevance score (0..1): Jaccard keyword overlap of title+description, with a
 * small boost when NAICS or PSC codes match. NAICS/PSC are a TIEBREAKER, never a
 * hard filter (agency coding is inconsistent).
 */
export const scoreCandidate = (
  current: {
    title?: string | null;
    description?: string | null;
    naicsCode?: string | null;
    pscCode?: string | null;
  },
  cand: HigherGovOpportunitySearchResult,
): number => {
  const a = new Set([...tokenize(current.title), ...tokenize(current.description)]);
  const b = new Set([
    ...tokenize(cand.title),
    ...tokenize(cand.description_text),
    ...tokenize(cand.ai_summary),
  ]);
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  const jaccard = overlap / (a.size + b.size - overlap);

  const naicsBoost = current.naicsCode && cand.naics_code?.naics_code === current.naicsCode ? 0.1 : 0;
  const pscBoost = current.pscCode && cand.psc_code?.psc_code === current.pscCode ? 0.1 : 0;

  return Math.min(1, jaccard + naicsBoost + pscBoost);
};

export type RankedCandidate = { cand: HigherGovOpportunitySearchResult; score: number };

/**
 * Rank agency-history candidates against the current opportunity: drop the
 * current opp itself and suppressed keys, score, threshold, sort desc, keep top N.
 */
export const rankRelatedRfps = (
  current: Parameters<typeof scoreCandidate>[0],
  candidates: HigherGovOpportunitySearchResult[],
  currentOppKey: string,
  suppressed: Set<string>,
): RankedCandidate[] =>
  candidates
    .filter((c) => c.opp_key !== currentOppKey && !suppressed.has(c.opp_key))
    .map((c) => ({ cand: c, score: scoreCandidate(current, c) }))
    .filter((x) => x.score >= RELATED_MATCH_THRESHOLD)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_AUTO_RELATED);
