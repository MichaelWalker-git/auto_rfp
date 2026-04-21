/**
 * POST /search-opportunities/import-highergov-favorites
 *
 * Imports selected (or all unimported) HigherGov pursuit/favorites as opportunities.
 * Body: { orgId, projectId, oppKeys?: string[], force?: boolean }
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { z } from 'zod';

import { apiResponse, getUserId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { HIGHERGOV_SECRET_PREFIX, HIGHERGOV_BASE_URL } from '@/constants/highergov';
import {
  fetchAllHigherGovPursuits,
  fetchHigherGovOpportunity,
  fetchHigherGovDocuments,
  type HigherGovConfig,
} from '@/helpers/highergov';
import { createOpportunity, findOpportunityBySourceId } from '@/helpers/opportunity';
import { syncOpportunityToApn } from '@/helpers/apn-db';
import { uploadToS3 } from '@/helpers/s3';
import { createQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';
import {
  httpsGetBuffer,
  guessContentType,
  buildAttachmentFilename,
  buildAttachmentS3Key,
} from '@/helpers/search-opportunity';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { resolveUserNames } from '@/helpers/resolve-users';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const httpsAgent = new https.Agent({ keepAlive: true });
const RATE_LIMIT_DELAY_MS = 150;

const RequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  /** If provided, only import these specific oppKeys. Otherwise import all unimported. */
  oppKeys: z.array(z.string().min(1)).optional(),
  /** Max to import in one request (default 50) */
  maxImport: z.number().int().positive().max(100).default(50),
  force: z.boolean().optional(),
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = RequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const apiKey = await getApiKey(data.orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'HigherGov API key not configured for this organization' });

  const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };

  // Fetch all pursuits
  const allPursuits = await fetchAllHigherGovPursuits(cfg);

  // Filter to requested oppKeys or all
  let pursuits = data.oppKeys?.length
    ? allPursuits.filter((p) => data.oppKeys!.includes(p.opp_key ?? p.unique_key))
    : allPursuits;
  pursuits = pursuits.slice(0, data.maxImport);

  const results: Array<{
    oppKey: string;
    title: string;
    status: 'imported' | 'skipped_duplicate' | 'failed';
    oppId?: string;
    error?: string;
  }> = [];

  for (const pursuit of pursuits) {
    const oppKey = pursuit.opp_key ?? pursuit.unique_key;
    try {
      // Dedup check
      if (!data.force) {
        const existing = await findOpportunityBySourceId({ orgId: data.orgId, higherGovOppKey: oppKey });
        if (existing) {
          results.push({ oppKey, title: pursuit.title ?? oppKey, status: 'skipped_duplicate', oppId: existing.oppId });
          continue;
        }
      }

      await delay(RATE_LIMIT_DELAY_MS);
      const opp = await fetchHigherGovOpportunity(cfg, oppKey);

      // Cross-source dedup
      if (!data.force && opp.source_id) {
        const existingBySam = await findOpportunityBySourceId({ orgId: data.orgId, noticeId: opp.source_id });
        if (existingBySam) {
          results.push({ oppKey, title: opp.title ?? oppKey, status: 'skipped_duplicate', oppId: existingBySam.oppId });
          continue;
        }
      }

      await delay(RATE_LIMIT_DELAY_MS);
      const attachments = await fetchHigherGovDocuments(cfg, opp.document_path, opp.opp_key);

      const agencyLabel = opp.agency?.name
        ? (opp.agency.abbreviation && opp.agency.abbreviation !== opp.agency.name
          ? `${opp.agency.name} (${opp.agency.abbreviation})`
          : opp.agency.name)
        : null;

      const { oppId, item } = await createOpportunity({
        orgId: data.orgId,
        projectId: data.projectId,
        opportunity: {
          orgId: data.orgId,
          projectId: data.projectId,
          source: 'HIGHER_GOV',
          id: oppKey,
          title: opp.title ?? pursuit.title ?? 'Untitled',
          type: opp.opp_type?.name ?? null,
          postedDateIso: opp.posted_date ? new Date(opp.posted_date).toISOString() : null,
          responseDeadlineIso: opp.due_date ? new Date(opp.due_date).toISOString() : null,
          noticeId: opp.source_id ?? null,
          solicitationNumber: null,
          naicsCode: opp.naics_code?.code ?? null,
          pscCode: opp.psc_code?.code ?? null,
          organizationName: agencyLabel,
          setAside: opp.set_aside ?? (opp.sole_source_flag ? 'Sole Source' : null),
          description: [opp.ai_summary, opp.description_text && opp.description_text !== opp.ai_summary ? opp.description_text : null, opp.product_service ? `Product/Service: ${opp.product_service}` : null].filter(Boolean).join('\n\n') || null,
          active: true,
          baseAndAllOptionsValue: opp.val_est_high ? (Number.isFinite(parseFloat(opp.val_est_high)) ? parseFloat(opp.val_est_high) : null) : null,
          placeOfPerformance: [opp.pop_city, opp.pop_state, opp.pop_zip, opp.pop_country].filter(Boolean).join(', ') || null,
          contactEmail: opp.primary_contact_email?.email ?? null,
          contactName: opp.primary_contact_email?.name ?? null,
          sourceUrl: opp.source_path ?? null,
          higherGovOppKey: oppKey,
          higherGovAiSummary: opp.ai_summary ?? null,
        },
      });

      await syncOpportunityToApn({
        orgId: data.orgId, projectId: data.projectId, oppId,
        customerName: item.organizationName ?? item.title ?? 'Unknown Customer',
        opportunityValue: item.baseAndAllOptionsValue ?? 0,
        expectedCloseDate: item.responseDeadlineIso ?? new Date().toISOString(),
        proposalStatus: 'PROSPECT',
        description: typeof item.description === 'string' ? item.description.substring(0, 500) : undefined,
      });

      // Import attachments
      for (const a of attachments) {
        try {
          await delay(RATE_LIMIT_DELAY_MS);
          const { buf, contentType, filename: headerFilename } = await httpsGetBuffer(new URL(a.url), { httpsAgent });
          const filename = buildAttachmentFilename(a, headerFilename);
          const ct = a.mimeType || contentType || guessContentType(filename);
          const fileKey = buildAttachmentS3Key({
            orgId: data.orgId, projectId: data.projectId,
            noticeId: oppKey, attachmentUrl: a.url, filename,
          });
          await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, ct ?? 'application/octet-stream');
          const qf = await createQuestionFile({
            orgId: data.orgId, oppId, projectId: data.projectId,
            fileKey, originalFileName: filename, mimeType: ct ?? 'application/octet-stream',
          });
          await startPipeline(data.projectId, oppId, qf.questionFileId, qf.fileKey, qf.mimeType ?? undefined);
        } catch (attachErr) {
          console.warn(`[importFavorites] Attachment failed ${a.url}:`, (attachErr as Error)?.message);
        }
      }

      results.push({ oppKey, title: item.title, status: 'imported', oppId });
    } catch (e) {
      results.push({ oppKey, title: pursuit.title ?? oppKey, status: 'failed', error: (e as Error)?.message });
    }
  }

  const imported = results.filter((r) => r.status === 'imported').length;
  const skipped = results.filter((r) => r.status === 'skipped_duplicate').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  setAuditContext(event, {
    action: 'SOLICITATION_IMPORTED',
    resource: 'opportunity',
    resourceId: `highergov-favorites-${imported}`,
    orgId: data.orgId,
  });

  const userId = getUserId(event);
  if (userId && imported > 0) {
    const nameMap = await resolveUserNames(data.orgId, [userId]).catch(() => ({} as Record<string, string>));
    const userName = nameMap[userId] ?? 'A user';
    await sendNotification(buildNotification(
      'SOLICITATION_IMPORTED', 'HigherGov favorites imported',
      `${userName} imported ${imported} opportunities from HigherGov favorites`,
      { orgId: data.orgId, projectId: data.projectId, recipientUserIds: [userId] },
    ));
  }

  return apiResponse(200, {
    ok: true,
    source: 'HIGHER_GOV',
    projectId: data.projectId,
    summary: { total: results.length, imported, skipped, failed, totalPursuits: allPursuits.length },
    results,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create'))
    .use(requirePermission('question:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
