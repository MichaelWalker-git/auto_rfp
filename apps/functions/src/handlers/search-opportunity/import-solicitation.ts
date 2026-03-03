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

import { apiResponse } from '@/helpers/api';
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
import { createOpportunity } from '@/helpers/opportunity';
import { createQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { getUserId } from '@/helpers/api';
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
  }),
  z.object({
    source:             z.literal('DIBBS'),
    orgId:              z.string().min(1),
    projectId:          z.string().min(1),
    solicitationNumber: z.string().min(1),
    sourceDocumentId:   z.string().optional(),
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
  return importDibbs(event, data);
};

// ─── SAM.gov description fetcher ─────────────────────────────────────────────

const ALLOWED_SAM_DOMAINS = ['api.sam.gov', 'sam.gov'];

function isSamGovUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ALLOWED_SAM_DOMAINS.some(d => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * If the description field is a SAM.gov URL, fetch the actual HTML/text content.
 * Returns the fetched content, or the original value if it's not a URL.
 */
async function resolveDescription(description: string | null | undefined, apiKey: string): Promise<string | null> {
  if (!description) return null;
  if (!isSamGovUrl(description)) return description;

  try {
    const url = new URL(description);
    url.searchParams.set('api_key', apiKey);
    const { buf, contentType } = await httpsGetBuffer(url, { httpsAgent });

    if (contentType?.includes('json')) {
      const json = JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
      // SAM.gov returns { opportunityDescription: '...' } or { description: '...' }
      const text = (json.opportunityDescription ?? json.description ?? json.content) as string | undefined;
      return text ?? buf.toString('utf-8');
    }

    // HTML or plain text — return as-is
    return buf.toString('utf-8');
  } catch (err) {
    console.warn(`[importSamGov] Failed to fetch description from ${description}:`, (err as Error)?.message);
    return description; // fall back to storing the URL if fetch fails
  }
}

// ─── SAM.gov import ───────────────────────────────────────────────────────────

const importSamGov = async (
  event: AuthedEvent,
  data: Extract<ImportRequest, { source: 'SAM_GOV' }>,
): Promise<APIGatewayProxyResultV2> => {
  const apiKey = await getApiKey(data.orgId, SAM_GOV_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'SAM.gov API key not configured for this organization' });

  const samCfg = { samApiOrigin: SAM_API_ORIGIN, httpsAgent };
  const oppRaw = await fetchOpportunityViaSearch(samCfg, {
    noticeId: data.noticeId,
    postedFrom: data.postedFrom,
    postedTo: data.postedTo,
    apiKey,
  });
  const attachments = extractAttachmentsFromOpportunity(oppRaw);

  // Resolve description: if it's a SAM.gov URL, fetch the actual content
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

  const files = await importAttachments({ orgId: data.orgId, projectId: data.projectId, id: data.noticeId, attachments, oppId, sourceDocumentId: data.sourceDocumentId });
  setAuditContext(event, { action: 'PROJECT_CREATED', resource: 'project', resourceId: oppId });

  // Send import notification
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

  return apiResponse(202, { ok: true, source: 'SAM_GOV', projectId: data.projectId, noticeId: data.noticeId, opportunityId: oppId, imported: files.length, opportunity: item, files });
};

// ─── DIBBS import ─────────────────────────────────────────────────────────────

const importDibbs = async (
  event: AuthedEvent,
  data: Extract<ImportRequest, { source: 'DIBBS' }>,
): Promise<APIGatewayProxyResultV2> => {
  const apiKey = await getApiKey(data.orgId, DIBBS_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'DIBBS API key not configured for this organization' });

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

  const files = await importAttachments({ orgId: data.orgId, projectId: data.projectId, id: data.solicitationNumber, attachments, oppId, sourceDocumentId: data.sourceDocumentId });
  setAuditContext(event, { action: 'PROJECT_CREATED', resource: 'project', resourceId: oppId });

  // Send import notification
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

  return apiResponse(202, { ok: true, source: 'DIBBS', projectId: data.projectId, solicitationNumber: data.solicitationNumber, opportunityId: oppId, imported: files.length, opportunity: item, files });
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
    // Fetch first so we have the Content-Disposition filename and content-type
    const { buf, contentType, filename: headerFilename } = await httpsGetBuffer(new URL(a.url), { httpsAgent });

    // Build filename: prefer Content-Disposition header, then attachment name, then URL path
    let filename = buildAttachmentFilename(a, headerFilename);

    // Determine content type
    const ct = a.mimeType || contentType || guessContentType(filename);

    // If filename still has no extension, try to add one from content-type
    if (filename && !filename.includes('.') && ct) {
      const extFromCt = contentTypeToExt(ct);
      if (extFromCt) filename = `${filename}${extFromCt}`;
    }

    const fileKey = buildAttachmentS3Key({ orgId: args.orgId, projectId: args.projectId, noticeId: args.id, attachmentUrl: a.url, filename });
    await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, ct ?? 'application/octet-stream');
    const qf = await createQuestionFile(args.orgId, { oppId: args.oppId, projectId: args.projectId, fileKey, originalFileName: filename, mimeType: ct ?? null, sourceDocumentId: args.sourceDocumentId });
    const { executionArn } = await startPipeline(args.projectId, args.oppId, qf.questionFileId, qf.fileKey, qf.mimeType ?? undefined);
    files.push({ questionFileId: qf.questionFileId, fileKey, executionArn });
  }
  return files;
};

/** Map common MIME types to file extensions */
function contentTypeToExt(ct: string): string | null {
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
}

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
