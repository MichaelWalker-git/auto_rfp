/**
 * Unified import-solicitation handler.
 * POST /search-opportunities/import-solicitation
 *
 * Body: { source: 'SAM_GOV' | 'DIBBS', orgId, projectId, ... }
 * Routes to the appropriate source-specific import logic.
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
import { uploadToS3 } from '@/helpers/s3';
import { createOpportunity, findOpportunityBySourceId } from '@/helpers/opportunity';
import { getProjectById } from '@/helpers/project';
import { syncOpportunityToApn } from '@/helpers/apn-db';
import { createQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { resolveUserNames } from '@/helpers/resolve-users';
import {
  httpsGetBuffer,
  guessContentType,
  buildAttachmentFilename,
  buildAttachmentS3Key,
  fetchOpportunityViaSearch,
  extractAttachmentsFromOpportunity,
  safeIsoOrNull,
  toBoolActive,
} from '@/helpers/search-opportunity';
import {
  fetchDibbsSolicitation,
  extractDibbsAttachments,
  type DibbsSearchConfig,
} from '@/helpers/search-opportunity';
import { SAM_GOV_SECRET_PREFIX } from '@/constants/samgov';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import { HIGHERGOV_SECRET_PREFIX, HIGHERGOV_BASE_URL } from '@/constants/highergov';
import {
  fetchHigherGovOpportunity,
  fetchHigherGovDocuments,
  type HigherGovConfig,
} from '@/helpers/search-opportunity';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const SAM_API_ORIGIN   = process.env.SAM_API_ORIGIN || 'https://api.sam.gov';
const DIBBS_BASE_URL   = requireEnv('DIBBS_BASE_URL', 'https://www.dibbs.bsm.dla.mil');
const httpsAgent = new https.Agent({ keepAlive: true });

// ─── Request schema ───────────────────────────────────────────────────────────

const ImportRequestSchema = z.discriminatedUnion('source', [
  z.object({
    source:           z.literal('SAM_GOV'),
    orgId:            z.string().min(1),
    projectId:        z.string().min(1),
    noticeId:         z.string().min(1),
    postedFrom:       z.string().min(1),
    postedTo:         z.string().min(1),
    sourceDocumentId: z.string().optional(),
    force:            z.boolean().optional(),
  }),
  z.object({
    source:             z.literal('DIBBS'),
    orgId:              z.string().min(1),
    projectId:          z.string().min(1),
    solicitationNumber: z.string().min(1),
    sourceDocumentId:   z.string().optional(),
    force:              z.boolean().optional(),
  }),
  z.object({
    source:           z.literal('HIGHER_GOV'),
    orgId:            z.string().min(1),
    projectId:        z.string().min(1),
    oppKey:           z.string().min(1),
    sourceDocumentId: z.string().optional(),
    force:            z.boolean().optional(),
  }),
]);

type ImportRequest = z.infer<typeof ImportRequestSchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = ImportRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  if (data.source === 'SAM_GOV') return importSamGov(event, data);
  if (data.source === 'DIBBS') return importDibbs(event, data);
  return importHigherGov(event, data);
};

// ─── SAM.gov description fetcher ─────────────────────────────────────────────

const ALLOWED_SAM_DOMAINS = ['api.sam.gov', 'sam.gov'];

const isSamGovUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ALLOWED_SAM_DOMAINS.some(d => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

/**
 * If the description field is a SAM.gov URL, fetch the actual HTML/text content.
 * Returns the fetched content, or the original value if it's not a URL.
 */
const resolveDescription = async (
  description: string | null | undefined,
  apiKey: string,
): Promise<string | null> => {
  if (!description) return null;
  if (!isSamGovUrl(description)) return description;

  try {
    const url = new URL(description);
    url.searchParams.set('api_key', apiKey);
    const { buf, contentType } = await httpsGetBuffer(url, { httpsAgent });

    if (contentType?.includes('json')) {
      const json = JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
      const text = (json.opportunityDescription ?? json.description ?? json.content) as string | undefined;
      return text ?? buf.toString('utf-8');
    }

    return buf.toString('utf-8');
  } catch (err) {
    console.warn(`[importSamGov] Failed to fetch description from ${description}:`, (err as Error)?.message);
    return description;
  }
};

/** Map common MIME types to file extensions */
const contentTypeToExt = (ct: string): string | null => {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt',
    'text/html': '.html',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/tiff': '.tiff',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
  };
  const base = ct.split(';')[0]?.trim().toLowerCase() ?? '';
  return map[base] ?? null;
};

// ─── SAM.gov import ───────────────────────────────────────────────────────────

const importSamGov = async (
  event: AuthedEvent,
  data: Extract<ImportRequest, { source: 'SAM_GOV' }>,
): Promise<APIGatewayProxyResultV2> => {
  const apiKey = await getApiKey(data.orgId, SAM_GOV_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'SAM.gov API key not configured for this organization' });

  if (!data.force) {
    const existing = await findOpportunityBySourceId({ orgId: data.orgId, noticeId: data.noticeId });
    if (existing) {
      const project = existing.projectId ? await getProjectById(existing.projectId) : null;
      return apiResponse(409, {
        message: 'This solicitation has already been imported for your organization.',
        existing: {
          oppId: existing.oppId,
          projectId: existing.projectId,
          projectName: project?.name ?? null,
          title: existing.title,
          noticeId: existing.noticeId,
          importedBy: existing.createdByName ?? null,
          importedAt: existing.createdAt,
        },
      });
    }
  }

  const samCfg = { samApiOrigin: SAM_API_ORIGIN, httpsAgent };
  const oppRaw = await fetchOpportunityViaSearch(samCfg, {
    noticeId: data.noticeId,
    postedFrom: data.postedFrom,
    postedTo: data.postedTo,
    apiKey,
  });
  const attachments = extractAttachmentsFromOpportunity(oppRaw);

  const rawDescription = ((oppRaw as Record<string, unknown>)?.description ?? null) as string | null;
  const description = await resolveDescription(rawDescription, apiKey);

  const { oppId, item } = await createOpportunity({
    orgId: data.orgId,
    projectId: data.projectId,
    opportunity: {
      orgId: data.orgId,
      projectId: data.projectId,
      source: 'SAM_GOV',
      id: data.noticeId,
      title: String((oppRaw as Record<string, unknown>)?.title ?? 'Untitled'),
      type: ((oppRaw as Record<string, unknown>)?.type ?? null) as string | null,
      postedDateIso: safeIsoOrNull((oppRaw as Record<string, unknown>)?.postedDate as string | undefined),
      responseDeadlineIso: safeIsoOrNull((oppRaw as Record<string, unknown>)?.responseDeadLine as string | undefined),
      noticeId: data.noticeId,
      solicitationNumber: ((oppRaw as Record<string, unknown>)?.solicitationNumber ?? null) as string | null,
      naicsCode: ((oppRaw as Record<string, unknown>)?.naicsCode ?? null) as string | null,
      pscCode: ((oppRaw as Record<string, unknown>)?.classificationCode ?? null) as string | null,
      organizationName: ((oppRaw as Record<string, unknown>)?.fullParentPathName ?? null) as string | null,
      setAside: ((oppRaw as Record<string, unknown>)?.setAside ?? null) as string | null,
      description,
      active: toBoolActive((oppRaw as Record<string, unknown>)?.active),
      baseAndAllOptionsValue: ((oppRaw as Record<string, unknown>)?.baseAndAllOptionsValue ?? null) as number | null,
    },
  });

  // Sync to AWS Partner Central (awaited for consistency; errors are logged but don't block import)
  await syncOpportunityToApn({
    orgId: data.orgId,
    projectId: data.projectId,
    oppId,
    customerName:      item.organizationName ?? item.title ?? 'Unknown Customer',
    opportunityValue:  item.baseAndAllOptionsValue ?? 0,
    expectedCloseDate: item.responseDeadlineIso ?? new Date().toISOString(),
    proposalStatus:    'PROSPECT',
    description:       typeof item.description === 'string' ? item.description.substring(0, 500) : undefined,
  });

  const files = await importAttachments({
    orgId: data.orgId,
    projectId: data.projectId,
    id: data.noticeId,
    attachments,
    oppId,
    sourceDocumentId: data.sourceDocumentId,
  });

  setAuditContext(event, {
    action: 'SOLICITATION_IMPORTED',
    resource: 'opportunity',
    resourceId: oppId,
    orgId: data.orgId,
    changes: {
      after: {
        source: 'SAM_GOV',
        noticeId: data.noticeId,
        projectId: data.projectId,
        filesImported: files.length,
      },
    },
  });

  const userId = getUserId(event);
  if (userId) {
    const nameMap = await resolveUserNames(data.orgId, [userId]).catch(() => ({} as Record<string, string>));
    const userName = nameMap[userId] ?? 'A user';
    const title = String((oppRaw as Record<string, unknown>)?.title ?? data.noticeId);
    await sendNotification(buildNotification(
      'SOLICITATION_IMPORTED',
      'New solicitation imported',
      `${userName} imported "${title}" from SAM.gov`,
      { orgId: data.orgId, projectId: data.projectId, entityId: oppId, recipientUserIds: [userId] },
    ));
  }

  return apiResponse(202, {
    ok: true,
    source: 'SAM_GOV',
    projectId: data.projectId,
    noticeId: data.noticeId,
    opportunityId: oppId,
    imported: files.length,
    opportunity: item,
    files,
  });
};

// ─── DIBBS import ─────────────────────────────────────────────────────────────

const importDibbs = async (
  event: AuthedEvent,
  data: Extract<ImportRequest, { source: 'DIBBS' }>,
): Promise<APIGatewayProxyResultV2> => {
  const apiKey = await getApiKey(data.orgId, DIBBS_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'DIBBS API key not configured for this organization' });

  if (!data.force) {
    const existing = await findOpportunityBySourceId({ orgId: data.orgId, solicitationNumber: data.solicitationNumber });
    if (existing) {
      const project = existing.projectId ? await getProjectById(existing.projectId) : null;
      return apiResponse(409, {
        message: 'This solicitation has already been imported for your organization.',
        existing: {
          oppId: existing.oppId,
          projectId: existing.projectId,
          projectName: project?.name ?? null,
          title: existing.title,
          solicitationNumber: existing.solicitationNumber,
          importedBy: existing.createdByName ?? null,
          importedAt: existing.createdAt,
        },
      });
    }
  }

  const cfg: DibbsSearchConfig = { baseUrl: DIBBS_BASE_URL, apiKey, httpsAgent };
  const oppRaw = await fetchDibbsSolicitation(cfg, data.solicitationNumber);
  const attachments = extractDibbsAttachments(oppRaw);

  const { oppId, item } = await createOpportunity({
    orgId: data.orgId,
    projectId: data.projectId,
    opportunity: {
      orgId: data.orgId,
      projectId: data.projectId,
      source: 'DIBBS',
      id: data.solicitationNumber,
      title: String(oppRaw?.title ?? 'Untitled'),
      type: (oppRaw?.type ?? null) as string | null,
      postedDateIso: oppRaw?.postedDate ? new Date(String(oppRaw.postedDate)).toISOString() : null,
      responseDeadlineIso: oppRaw?.closingDate ? new Date(String(oppRaw.closingDate)).toISOString() : null,
      noticeId: null,
      solicitationNumber: data.solicitationNumber,
      naicsCode: (oppRaw?.naicsCode ?? null) as string | null,
      pscCode: (oppRaw?.pscCode ?? null) as string | null,
      organizationName: (oppRaw?.dodComponent ?? null) as string | null,
      setAside: (oppRaw?.setAside ?? null) as string | null,
      description: (oppRaw?.description ?? null) as string | null,
      active: true,
      baseAndAllOptionsValue: typeof oppRaw?.baseAndAllOptionsValue === 'number' ? oppRaw.baseAndAllOptionsValue : null,
    },
  });

  // Sync to AWS Partner Central (awaited for consistency; errors are logged but don't block import)
  await syncOpportunityToApn({
    orgId: data.orgId,
    projectId: data.projectId,
    oppId,
    customerName:      item.organizationName ?? item.title ?? 'Unknown Customer',
    opportunityValue:  item.baseAndAllOptionsValue ?? 0,
    expectedCloseDate: item.responseDeadlineIso ?? new Date().toISOString(),
    proposalStatus:    'PROSPECT',
    description:       typeof item.description === 'string' ? item.description.substring(0, 500) : undefined,
  });

  const files = await importAttachments({
    orgId: data.orgId,
    projectId: data.projectId,
    id: data.solicitationNumber,
    attachments,
    oppId,
    sourceDocumentId: data.sourceDocumentId,
  });

  setAuditContext(event, {
    action: 'SOLICITATION_IMPORTED',
    resource: 'opportunity',
    resourceId: oppId,
    orgId: data.orgId,
    changes: {
      after: {
        source: 'DIBBS',
        solicitationNumber: data.solicitationNumber,
        projectId: data.projectId,
        filesImported: files.length,
      },
    },
  });

  const userId = getUserId(event);
  if (userId) {
    const nameMap = await resolveUserNames(data.orgId, [userId]).catch(() => ({} as Record<string, string>));
    const userName = nameMap[userId] ?? 'A user';
    const title = String(oppRaw?.title ?? data.solicitationNumber);
    await sendNotification(buildNotification(
      'SOLICITATION_IMPORTED',
      'New solicitation imported',
      `${userName} imported "${title}" from DIBBS`,
      { orgId: data.orgId, projectId: data.projectId, entityId: oppId, recipientUserIds: [userId] },
    ));
  }

  return apiResponse(202, {
    ok: true,
    source: 'DIBBS',
    projectId: data.projectId,
    solicitationNumber: data.solicitationNumber,
    opportunityId: oppId,
    imported: files.length,
    opportunity: item,
    files,
  });
};

// ─── HigherGov import ────────────────────────────────────────────────────────

const importHigherGov = async (
  event: AuthedEvent,
  data: Extract<ImportRequest, { source: 'HIGHER_GOV' }>,
): Promise<APIGatewayProxyResultV2> => {
  const apiKey = await getApiKey(data.orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'HigherGov API key not configured for this organization' });

  const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };
  const opp = await fetchHigherGovOpportunity(cfg, data.oppKey);

  // Cross-source dedup: check by higherGovOppKey AND by noticeId (source_id = SAM.gov noticeId)
  if (!data.force) {
    const existingByOppKey = await findOpportunityBySourceId({ orgId: data.orgId, higherGovOppKey: data.oppKey });
    const existingByNoticeId = opp.source_id
      ? await findOpportunityBySourceId({ orgId: data.orgId, noticeId: opp.source_id })
      : undefined;
    const existing = existingByOppKey ?? existingByNoticeId;

    if (existing) {
      const project = existing.projectId ? await getProjectById(existing.projectId) : null;
      return apiResponse(409, {
        message: `This opportunity has already been imported (from ${existing.source}).`,
        existing: {
          oppId: existing.oppId,
          projectId: existing.projectId,
          projectName: project?.name ?? null,
          title: existing.title,
          source: existing.source,
          importedBy: existing.createdByName ?? null,
          importedAt: existing.createdAt,
        },
      });
    }
  }

  const attachments = await fetchHigherGovDocuments(cfg, opp.document_path, opp.opp_key);

  const { oppId, item } = await createOpportunity({
    orgId: data.orgId,
    projectId: data.projectId,
    opportunity: {
      orgId: data.orgId,
      projectId: data.projectId,
      source: 'HIGHER_GOV',
      id: opp.opp_key,
      title: opp.title ?? 'Untitled',
      type: opp.opp_type?.name ?? null,
      postedDateIso: opp.posted_date ? new Date(opp.posted_date).toISOString() : null,
      responseDeadlineIso: opp.due_date ? new Date(opp.due_date).toISOString() : null,
      noticeId: opp.source_id ?? null,
      solicitationNumber: null,
      naicsCode: opp.naics_code?.code ?? null,
      pscCode: opp.psc_code?.code ?? null,
      organizationName: opp.agency?.name
        ? (opp.agency.abbreviation && opp.agency.abbreviation !== opp.agency.name
            ? `${opp.agency.name} (${opp.agency.abbreviation})`
            : opp.agency.name)
        : null,
      setAside: opp.set_aside ?? (opp.sole_source_flag ? 'Sole Source' : null),
      description: [
        opp.ai_summary,
        opp.description_text && opp.description_text !== opp.ai_summary ? opp.description_text : null,
        opp.product_service ? `Product/Service: ${opp.product_service}` : null,
      ].filter(Boolean).join('\n\n') || null,
      active: true,
      baseAndAllOptionsValue: opp.val_est_high ? parseFloat(opp.val_est_high) || null : null,
      // HigherGov-enriched fields
      placeOfPerformance: [opp.pop_city, opp.pop_state, opp.pop_zip, opp.pop_country].filter(Boolean).join(', ') || null,
      contactEmail: opp.primary_contact_email?.email ?? null,
      contactName: opp.primary_contact_email?.name ?? null,
      sourceUrl: opp.source_path ?? null,
      higherGovOppKey: opp.opp_key,
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

  const files = await importAttachments({
    orgId: data.orgId, projectId: data.projectId,
    id: opp.opp_key, attachments, oppId,
    sourceDocumentId: data.sourceDocumentId,
  });

  setAuditContext(event, {
    action: 'SOLICITATION_IMPORTED',
    resource: 'opportunity',
    resourceId: oppId,
    orgId: data.orgId,
    changes: { after: { source: 'HIGHER_GOV', higherGovOppKey: opp.opp_key, projectId: data.projectId, filesImported: files.length } },
  });

  const userId = getUserId(event);
  if (userId) {
    const nameMap = await resolveUserNames(data.orgId, [userId]).catch(() => ({} as Record<string, string>));
    const userName = nameMap[userId] ?? 'A user';
    await sendNotification(buildNotification(
      'SOLICITATION_IMPORTED',
      'New solicitation imported',
      `${userName} imported "${opp.title}" from HigherGov`,
      { orgId: data.orgId, projectId: data.projectId, entityId: oppId, recipientUserIds: [userId] },
    ));
  }

  return apiResponse(202, {
    ok: true, source: 'HIGHER_GOV', projectId: data.projectId,
    higherGovOppKey: opp.opp_key, opportunityId: oppId,
    imported: files.length, opportunity: item, files,
  });
};

// ─── Shared attachment import ─────────────────────────────────────────────────

type Attachment = { url: string; name?: string; mimeType?: string };

const importAttachments = async (args: {
  orgId: string;
  projectId: string;
  id: string;
  attachments: Attachment[];
  oppId: string;
  sourceDocumentId?: string;
}): Promise<Array<{ questionFileId: string; fileKey: string; executionArn?: string }>> => {
  const files: Array<{ questionFileId: string; fileKey: string; executionArn?: string }> = [];

  for (const a of args.attachments) {
    const { buf, contentType, filename: headerFilename } = await httpsGetBuffer(new URL(a.url), { httpsAgent });

    let filename = buildAttachmentFilename(a, headerFilename);
    const ct = a.mimeType || contentType || guessContentType(filename);

    if (filename && !filename.includes('.') && ct) {
      const extFromCt = contentTypeToExt(ct);
      if (extFromCt) filename = `${filename}${extFromCt}`;
    }

    const fileKey = buildAttachmentS3Key({
      orgId: args.orgId,
      projectId: args.projectId,
      noticeId: args.id,
      attachmentUrl: a.url,
      filename,
    });

    await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, ct ?? 'application/octet-stream');

    const qf = await createQuestionFile({
      orgId: args.orgId,
      oppId: args.oppId,
      projectId: args.projectId,
      fileKey,
      originalFileName: filename,
      mimeType: ct ?? 'application/octet-stream',
      sourceDocumentId: args.sourceDocumentId,
    });

    const { executionArn } = await startPipeline(
      args.projectId,
      args.oppId,
      qf.questionFileId,
      qf.fileKey,
      qf.mimeType ?? undefined,
    );

    files.push({ questionFileId: qf.questionFileId, fileKey, executionArn });
  }

  return files;
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create'))
    .use(requirePermission('question:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
