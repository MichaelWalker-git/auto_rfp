import https from 'https';
import crypto from 'crypto';
import path from 'path';
import type { LoadSamOpportunitiesRequest, LoadSamOpportunitiesResponse, SamOpportunitySlim, } from '@auto-rfp/shared';
import { readPlainSecret } from './secret';

const DEFAULT_LIMIT = 25;
const DEFAULT_OFFSET = 0;

export type SamSearchConfig = {
  baseUrl: string;        // e.g. https://api.sam.gov
  apiKey: string;         // already resolved secret
  httpsAgent?: https.Agent;
};

function addQueryParam(url: URL, key: string, value: any) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const v of value) {
      const s = String(v ?? '').trim();
      if (s) url.searchParams.append(key, s);
    }
    return;
  }

  const s = String(value ?? '').trim();
  if (s) url.searchParams.set(key, s);
}

function clampLimit(n: number | undefined) {
  const v = Number(n ?? DEFAULT_LIMIT);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_LIMIT;
  return Math.min(1000, Math.floor(v));
}

function clampOffset(n: number | undefined) {
  const v = Number(n ?? DEFAULT_OFFSET);
  if (!Number.isFinite(v) || v < 0) return DEFAULT_OFFSET;
  return Math.floor(v);
}

async function httpsGetJson(url: URL, agent?: https.Agent): Promise<any> {
  const bodyStr = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: { Accept: 'application/json' },
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(text);
          else reject(new Error(`SAM.gov error: ${res.statusCode} ${res.statusMessage} - ${text}`));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

  return JSON.parse(bodyStr);
}

function toNumber(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const getAttachmentsCount = (x: any): number => {
  const candidates = [
    x?.attachments,
    x?.resourceLinks,
    x?.resources,
    x?.links,
    x?.documents,
    x?.attachment,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c.length;
  }

  if (typeof x?.attachmentsCount === 'number') return x.attachmentsCount;
  if (typeof x?.numAttachments === 'number') return x.numAttachments;

  return 0;
};

function toSlim(o: any): SamOpportunitySlim {
  const baseAndAllOptionsValue =
    toNumber(o?.baseAndAllOptionsValue) ??
    toNumber(o?.baseAndAllOptions?.value) ??
    toNumber(o?.award?.amount);

  const attachmentsCount = getAttachmentsCount(o);

  return {
    noticeId: o?.noticeId ?? o?.noticeid,
    solicitationNumber: o?.solicitationNumber ?? o?.solnum,
    title: o?.title,
    type: o?.type,
    postedDate: o?.postedDate,
    responseDeadLine: o?.responseDeadLine ?? o?.reponseDeadLine,
    naicsCode: o?.naicsCode ?? o?.ncode,
    classificationCode: o?.classificationCode ?? o?.ccode,
    active: o?.active,
    setAside: o?.setAside,
    setAsideCode: o?.setAsideCode,
    fullParentPathName: o?.fullParentPathName,
    fullParentPathCode: o?.fullParentPathCode,
    description: o?.description,
    baseAndAllOptionsValue,
    award: o?.award,
    attachmentsCount,
  };
}

function filterByDollarRange(items: SamOpportunitySlim[], range?: { min?: number; max?: number }) {
  if (!range) return items;
  const min = range.min;
  const max = range.max;

  return items.filter((it) => {
    const v = it.baseAndAllOptionsValue;
    if (v == null) return true;
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
    return true;
  });
}

export async function searchSamOpportunities(
  cfg: SamSearchConfig,
  body: LoadSamOpportunitiesRequest,
): Promise<LoadSamOpportunitiesResponse> {
  const limit = clampLimit(body.limit);
  const offset = clampOffset(body.offset);

  const url = new URL('/opportunities/v2/search', cfg.baseUrl);

  addQueryParam(url, 'api_key', cfg.apiKey);

  addQueryParam(url, 'postedFrom', body.postedFrom);
  addQueryParam(url, 'postedTo', body.postedTo);

  if (body.naics?.length) addQueryParam(url, 'ncode', body.naics);
  if (body.psc?.length) addQueryParam(url, 'ccode', body.psc);

  const titleQuery = body.title ?? body.keywords;
  if (titleQuery) addQueryParam(url, 'title', titleQuery);

  addQueryParam(url, 'organizationCode', body.organizationCode);
  addQueryParam(url, 'organizationName', body.organizationName);

  addQueryParam(url, 'setAsideCode', body.setAsideCode);
  addQueryParam(url, 'ptype', body.ptype);

  addQueryParam(url, 'state', body.state);
  addQueryParam(url, 'zip', body.zip);

  addQueryParam(url, 'limit', String(limit));
  addQueryParam(url, 'offset', String(offset));
  if (body.rdlfrom) addQueryParam(url, 'rdlfrom', body.rdlfrom);

  const json = await httpsGetJson(url, cfg.httpsAgent);

  const totalRecords = Number(json?.totalRecords ?? 0) || 0;
  const respLimit = Number(json?.limit ?? limit) || limit;
  const respOffset = Number(json?.offset ?? offset) || offset;

  const rawList: any[] =
    (Array.isArray(json?.opportunitiesData) && json.opportunitiesData) ||
    (Array.isArray(json?.data) && json.data) ||
    (Array.isArray(json?.results) && json.results) ||
    [];

  let opportunities = rawList.map(toSlim);
  opportunities = filterByDollarRange(opportunities, body.dollarRange);

  return {
    totalRecords,
    limit: respLimit,
    offset: respOffset,
    opportunities,
  };
}


export type ImportSamConfig = {
  samApiOrigin: string; // https://api.sam.gov
  samApiKeySecretId: string;
  httpsAgent?: https.Agent;
};

export type Attachment = {
  url: string;
  name?: string;
  mimeType?: string;
};

export function sha1(s: string) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

export function safeFilename(name: string) {
  const base = String(name || '')
    .replace(/[^\w.\-() ]+/g, '_')
    .trim();
  return base || 'attachment';
}

export function guessExtFromUrl(u: string) {
  try {
    const p = new URL(u).pathname;
    const ext = path.extname(p);
    if (ext && ext.length <= 10) return ext;
  } catch {
  }
  return '';
}

export function guessContentType(filename: string) {
  const f = filename.toLowerCase();
  if (f.endsWith('.pdf')) return 'application/pdf';
  if (f.endsWith('.doc')) return 'application/msword';
  if (f.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (f.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (f.endsWith('.xlsx'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (f.endsWith('.csv')) return 'text/csv';
  if (f.endsWith('.txt')) return 'text/plain';
  if (f.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

/**
 * Extract filename from Content-Disposition header
 * Supports both filename and filename* (RFC 5987) formats
 */
function extractFilenameFromHeader(contentDisposition?: string): string | undefined {
  if (!contentDisposition) return undefined;

  // Try filename* first (RFC 5987 - supports UTF-8 encoding)
  const filenameStar = /filename\*=(?:UTF-8''|utf-8'')([^;\s]+)/i.exec(contentDisposition);
  if (filenameStar?.[1]) {
    try {
      return decodeURIComponent(filenameStar[1]);
    } catch {
      // Fall through to other methods if decoding fails
    }
  }

  // Try quoted filename
  const filenameQuoted = /filename="([^"]+)"/i.exec(contentDisposition);
  if (filenameQuoted?.[1]) {
    return filenameQuoted[1];
  }

  // Try unquoted filename
  const filenameUnquoted = /filename=([^;\s]+)/i.exec(contentDisposition);
  if (filenameUnquoted?.[1]) {
    return filenameUnquoted[1];
  }

  return undefined;
}

export async function httpsGetBuffer(
  url: URL,
  opts?: { maxRedirects?: number; httpsAgent?: https.Agent },
): Promise<{ buf: Buffer; contentType?: string; finalUrl: string; filename?: string }> {
  const maxRedirects = opts?.maxRedirects ?? 5;

  const normalize = (v?: string) => (v ? (v.split(';')[0] ?? v).trim().toLowerCase() : undefined);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Accept: '*/*',
          'User-Agent': 'AutoRFP/1.0',
        },
        agent: opts?.httpsAgent,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const ct = normalize(res.headers['content-type'] as string | undefined);
        const contentDisposition = res.headers['content-disposition'] as string | undefined;
        const headerFilename = extractFilenameFromHeader(contentDisposition);

        if ([301, 302, 303, 307, 308].includes(status)) {
          const loc = res.headers.location ? String(res.headers.location) : '';
          if (!loc) {
            reject(new Error(`Redirect (${status}) without Location header (${url.toString()})`));
            return;
          }
          if (maxRedirects <= 0) {
            reject(new Error(`Too many redirects while fetching ${url.toString()}`));
            return;
          }

          const nextUrl = new URL(loc, url);
          res.resume();

          httpsGetBuffer(nextUrl, {
            maxRedirects: maxRedirects - 1,
            httpsAgent: opts?.httpsAgent,
          })
            .then((r) => {
              resolve({
                buf: r.buf,
                contentType:
                  r.contentType && r.contentType !== 'application/octet-stream'
                    ? r.contentType
                    : ct,
                finalUrl: r.finalUrl,
                filename: r.filename || headerFilename,
              });
            })
            .catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const body = Buffer.concat(chunks);

          if (status >= 200 && status < 300) {
            resolve({
              buf: body,
              contentType: ct,
              finalUrl: url.toString(),
              filename: headerFilename,
            });
            return;
          }

          reject(
            new Error(
              `GET failed: ${status} ${res.statusMessage} (${url.toString()}) - ${body
                .toString('utf-8')
                .slice(0, 800)}`,
            ),
          );
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

export async function fetchOpportunityViaSearch(cfg: ImportSamConfig, args: {
  noticeId: string;
  postedFrom: string;
  postedTo: string;
}): Promise<any> {
  const apiKey = await readPlainSecret(cfg.samApiKeySecretId);

  const u = new URL('/opportunities/v2/search', cfg.samApiOrigin);
  u.searchParams.set('api_key', apiKey);
  u.searchParams.set('noticeid', args.noticeId);
  u.searchParams.set('postedFrom', args.postedFrom);
  u.searchParams.set('postedTo', args.postedTo);
  u.searchParams.set('limit', '1');
  u.searchParams.set('offset', '0');

  const json = await httpsGetJson(u, cfg.httpsAgent);
  const opp = json?.opportunitiesData?.[0];
  if (!opp) throw new Error(`SAM search returned no data for noticeId=${args.noticeId}`);
  return opp;
}

export function extractAttachmentsFromOpportunity(opp: any): Attachment[] {
  const out: Attachment[] = [];

  const push = (u?: any, name?: any, mimeType?: any) => {
    const url = String(u ?? '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return;
    out.push({
      url,
      name: name ? String(name) : undefined,
      mimeType: mimeType ? String(mimeType) : undefined,
    });
  };

  const resourceLinks = opp?.resourceLinks ?? opp?.data?.resourceLinks;
  if (Array.isArray(resourceLinks)) {
    for (const r of resourceLinks) {
      if (typeof r === 'string') push(r);
      else push(r?.url ?? r?.href ?? r?.link, r?.name ?? r?.title, r?.mimeType);
    }
  }

  const attachments = opp?.attachments ?? opp?.data?.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) push(a?.url ?? a?.downloadUrl ?? a?.link, a?.fileName ?? a?.name, a?.mimeType);
  }

  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}

export function buildAttachmentFilename(a: Attachment, headerFilename?: string) {
  // Prefer filename from Content-Disposition header
  if (headerFilename) {
    const sanitized = safeFilename(headerFilename);
    if (sanitized && sanitized !== 'attachment') {
      return sanitized;
    }
  }

  // Fall back to attachment name or URL-derived name
  const url = new URL(a.url);
  const rawName = a.name ?? path.basename(url.pathname);
  const extFromName = path.extname(rawName);
  const ext = extFromName || guessExtFromUrl(a.url);
  const base = safeFilename(
    ext ? rawName.slice(0, -ext.length) : rawName
  );

  return ext ? `${base}${ext}` : base;
}

export function buildAttachmentS3Key(args: {
  orgId: string;
  projectId: string;
  noticeId: string;
  attachmentUrl: string;
  filename: string;
}) {
  const urlHash = sha1(`${args.noticeId}:${args.attachmentUrl}`);
  return `org/${args.orgId}/projects/${args.projectId}/sam/${args.noticeId}/${urlHash}/${args.filename}`;
}


export const toBoolActive = (v: any) => v === true || String(v).toLowerCase() === 'yes' || String(v).toLowerCase() === 'true';

export const safeIsoOrNull = (s?: string) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};