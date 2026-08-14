/**
 * find-related-rfps — async worker (HOR-2610).
 *
 * Invoked fire-and-forget (InvocationType: 'Event') after a HigherGov-sourced
 * opportunity is imported, and by the manual refresh endpoint. NOT fronted by
 * API Gateway — no middy, no apiResponse.
 *
 * Flow:
 *   1. load the opportunity; guard on higherGovOppKey
 *   2. resolve agency_key via fetchHigherGovOpportunity (not stored on our record)
 *   3. search the agency's history + rank by keyword relevance (top N)
 *   4. drop the current opp + suppressed keys
 *   5. replace AUTO links only, persisting with cross-link dedup
 */

import https from 'https';

import { withSentryLambda } from '@/sentry-lambda';
import { getApiKey } from '@/helpers/api-key-storage';
import { HIGHERGOV_SECRET_PREFIX, HIGHERGOV_BASE_URL } from '@/constants/highergov';
import {
  fetchHigherGovOpportunity,
  searchHigherGovOpportunities,
  type HigherGovConfig,
} from '@/helpers/highergov';
import { getOpportunity } from '@/helpers/opportunity';
import {
  rankRelatedRfps,
  deleteAutoRelatedRfps,
  createRelatedRfp,
  listSuppressedOppKeys,
  resolveLinkedOpportunityId,
} from '@/helpers/related-rfp';
import { AGENCY_FETCH_PAGE_SIZE } from '@/constants/related-rfp';
import { buildAgencyLabel } from '@auto-rfp/core';

const httpsAgent = new https.Agent({ keepAlive: true });

export type FindRelatedRfpsEvent = {
  orgId: string;
  projectId: string;
  oppId: string;
};

export type FindRelatedRfpsResult = {
  created: number;
  skippedReason?: string;
};

export const findRelatedRfpsForOpportunity = async (
  input: FindRelatedRfpsEvent,
): Promise<FindRelatedRfpsResult> => {
  const { orgId, projectId, oppId } = input;
  if (!orgId || !projectId || !oppId) return { created: 0, skippedReason: 'missing-identifiers' };

  const found = await getOpportunity({ orgId, projectId, oppId });
  const opp = found?.item;
  if (!opp) return { created: 0, skippedReason: 'opportunity-not-found' };
  if (!opp.higherGovOppKey) return { created: 0, skippedReason: 'not-highergov-sourced' };

  const apiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) return { created: 0, skippedReason: 'no-highergov-key' };

  const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };

  // 1. resolve agency_key (not stored on our record)
  const source = await fetchHigherGovOpportunity(cfg, opp.higherGovOppKey);
  const agencyKey =
    source.agency?.agency_key != null ? String(source.agency.agency_key) : undefined;
  if (!agencyKey) return { created: 0, skippedReason: 'no-agency-key' };

  // 2. fetch agency history + rank
  const { results } = await searchHigherGovOpportunities(cfg, {
    agencyKey,
    pageSize: AGENCY_FETCH_PAGE_SIZE,
  });
  const suppressed = await listSuppressedOppKeys(orgId, projectId, oppId);
  const ranked = rankRelatedRfps(
    { title: opp.title, description: opp.description, naicsCode: opp.naicsCode, pscCode: opp.pscCode },
    results,
    opp.higherGovOppKey,
    suppressed,
  );

  // 3. replace AUTO links only, then persist with cross-link dedup
  await deleteAutoRelatedRfps(orgId, projectId, oppId);

  let created = 0;
  for (const { cand, score } of ranked) {
    const linkedOpportunityId = await resolveLinkedOpportunityId(orgId, cand.opp_key, cand.source_id);

    await createRelatedRfp({
      orgId,
      projectId,
      oppId,
      relatedOppKey: cand.opp_key,
      title: cand.title ?? 'Untitled',
      organizationName: buildAgencyLabel(cand.agency),
      postedDateIso: cand.posted_date ?? null,
      dueDateIso: cand.due_date ?? null,
      sourceUrl: cand.source_path ?? cand.path ?? null,
      matchScore: score,
      origin: 'AUTO',
      linkedOpportunityId,
    });
    created++;
  }

  return { created };
};

export const handler = withSentryLambda(
  async (event: FindRelatedRfpsEvent): Promise<FindRelatedRfpsResult> =>
    findRelatedRfpsForOpportunity(event),
);
