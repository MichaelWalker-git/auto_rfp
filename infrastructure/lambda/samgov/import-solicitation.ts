import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import crypto from 'crypto';
import path from 'path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';

import { apiResponse } from '../helpers/api';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { readPlainSecret } from '../helpers/secret';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// From docs: prod base = https://api.sam.gov (NOT /prod)
const SAM_API_ORIGIN = process.env.SAM_API_ORIGIN || 'https://api.sam.gov';
const SAM_GOV_API_KEY_SECRET_ID = requireEnv('SAM_GOV_API_KEY_SECRET_ID');

const s3 = new S3Client({});
const sfn = new SFNClient({});

type ImportSolicitationBody = {
  orgId: string;
  projectId: string;
  noticeId: string;

  // REQUIRED by Get Opportunities v2 search
  postedFrom: string; // MM/dd/yyyy
  postedTo: string;   // MM/dd/yyyy

  sourceDocumentId?: string;
};

type Attachment = {
  url: string;
  name?: string;
  mimeType?: string;
};

function sha1(s: string) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function safeFilename(name: string) {
  const base = String(name || '')
    .replace(/[^\w.\-() ]+/g, '_')
    .trim();
  return base || 'attachment';
}

function guessExtFromUrl(u: string) {
  try {
    const p = new URL(u).pathname;
    const ext = path.extname(p);
    if (ext && ext.length <= 10) return ext;
  } catch {}
  return '';
}

function guessContentType(filename: string) {
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

function httpsGetBuffer(
  url: URL,
  opts?: { maxRedirects?: number },
): Promise<{ buf: Buffer; contentType?: string; finalUrl: string }> {
  const maxRedirects = opts?.maxRedirects ?? 5;

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
      },
      (res) => {
        const status = res.statusCode ?? 0;

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

          const nextUrl = new URL(loc, url); // handles relative redirects too
          // Important: consume response data to free socket
          res.resume();

          resolve(
            httpsGetBuffer(nextUrl, { maxRedirects: maxRedirects - 1 }),
          );
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const body = Buffer.concat(chunks);

          if (status >= 200 && status < 300) {
            resolve({
              buf: body,
              contentType: res.headers['content-type'] ? String(res.headers['content-type']) : undefined,
              finalUrl: url.toString(),
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

async function httpsGetJson(url: URL): Promise<any> {
  const { buf } = await httpsGetBuffer(url);
  const raw = buf.toString('utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON from (${url.toString()}): ${raw.slice(0, 500)}`);
  }
}

/**
 * ✅ Correct public API per docs: GET /opportunities/v2/search
 * Requires postedFrom & postedTo.
 */
async function fetchOpportunityViaSearch(args: {
  noticeId: string;
  postedFrom: string;
  postedTo: string;
}): Promise<any> {
  const apiKey = await readPlainSecret(SAM_GOV_API_KEY_SECRET_ID);

  const u = new URL('/opportunities/v2/search', SAM_API_ORIGIN);
  u.searchParams.set('api_key', apiKey);
  u.searchParams.set('noticeid', args.noticeId);
  u.searchParams.set('postedFrom', args.postedFrom);
  u.searchParams.set('postedTo', args.postedTo);

  // optional: minimize payload
  u.searchParams.set('limit', '1');
  u.searchParams.set('offset', '0');

  console.log('SAM search URL:', u.toString());
  const json = await httpsGetJson(u);

  const opp = json?.opportunitiesData?.[0];
  if (!opp) {
    // per docs: search can return 404 “No Data found”
    throw new Error(`SAM search returned no data for noticeId=${args.noticeId}`);
  }
  return opp;
}

/**
 * Extract attachments from the opportunity record returned by /opportunities/v2/search.
 * Most important: resourceLinks is where attachment URLs usually live.
 */
function extractAttachmentsFromOpportunity(opp: any): Attachment[] {
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

  // From docs: "resourceLinks" is "Direct URL to download attachments"
  const resourceLinks = opp?.resourceLinks ?? opp?.data?.resourceLinks;
  if (Array.isArray(resourceLinks)) {
    for (const r of resourceLinks) {
      // Sometimes it's an array of strings, sometimes objects
      if (typeof r === 'string') push(r);
      else push(r?.url ?? r?.href ?? r?.link, r?.name ?? r?.title, r?.mimeType);
    }
  }

  // Keep your old defensive shapes too (sometimes nested)
  const attachments = opp?.attachments ?? opp?.data?.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) push(a?.url ?? a?.downloadUrl ?? a?.link, a?.fileName ?? a?.name, a?.mimeType);
  }

  // De-dupe by URL
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}

async function uploadToS3(bucket: string, key: string, body: Buffer, contentType?: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

async function createQuestionFile(args: {
  projectId: string;
  fileKey: string;
  originalFileName?: string;
  mimeType?: string;
  sourceDocumentId?: string;
}) {
  const now = new Date().toISOString();
  const questionFileId = uuidv4();
  const sk = `${args.projectId}#${questionFileId}`;

  const item: Record<string, any> = {
    [PK_NAME]: QUESTION_FILE_PK,
    [SK_NAME]: sk,

    questionFileId,
    projectId: args.projectId,
    fileKey: args.fileKey,
    textFileKey: null,
    status: 'uploaded',
    originalFileName: args.originalFileName ?? null,
    mimeType: args.mimeType ?? null,
    sourceDocumentId: args.sourceDocumentId ?? null,

    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

  return { questionFileId };
}

async function markProcessing(projectId: string, questionFileId: string) {
  const sk = `${projectId}#${questionFileId}`;
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
        '#status': 'status',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'PROCESSING',
        ':updatedAt': now,
      },
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
    }),
  );
}

async function startPipeline(projectId: string, questionFileId: string) {
  const res = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({ questionFileId, projectId }),
    }),
  );

  return { executionArn: res.executionArn, startDate: res.startDate };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let body: ImportSolicitationBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const { orgId, projectId, noticeId, postedFrom, postedTo } = body;

  if (!orgId || !projectId || !noticeId || !postedFrom || !postedTo) {
    return apiResponse(400, {
      message: 'orgId, projectId, noticeId, postedFrom, postedTo are required',
    });
  }

  console.log('import-solicitation input:', { orgId, projectId, noticeId, postedFrom, postedTo });

  try {
    const opp = await fetchOpportunityViaSearch({ noticeId, postedFrom, postedTo });
    const attachments = extractAttachmentsFromOpportunity(opp);

    if (!attachments.length) {
      return apiResponse(200, {
        ok: true,
        noticeId,
        projectId,
        imported: 0,
        message: 'No attachments found (resourceLinks empty)',
      });
    }

    const results: Array<{
      questionFileId: string;
      fileKey: string;
      originalFileName?: string;
      executionArn?: string;
      url: string;
    }> = [];

    for (const a of attachments) {
      const url = new URL(a.url);

      const baseName = safeFilename(a.name ?? path.basename(url.pathname));
      const ext = path.extname(baseName) || guessExtFromUrl(a.url);
      const filename = ext ? (baseName.endsWith(ext) ? baseName : `${baseName}${ext}`) : baseName;

      const urlHash = sha1(`${noticeId}:${a.url}`);
      const fileKey = `org_${orgId}/projects/${projectId}/sam/${noticeId}/${urlHash}/${filename}`;

      console.log('Downloading attachment:', a.url);
      const { buf, contentType } = await httpsGetBuffer(url);

      const finalContentType = a.mimeType || contentType || guessContentType(filename);
      await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, finalContentType);

      const { questionFileId } = await createQuestionFile({
        projectId,
        fileKey,
        originalFileName: filename,
        mimeType: finalContentType,
        sourceDocumentId: body.sourceDocumentId,
      });

      await markProcessing(projectId, questionFileId);
      const started = await startPipeline(projectId, questionFileId);

      results.push({
        questionFileId,
        fileKey,
        originalFileName: filename,
        executionArn: started.executionArn,
        url: a.url,
      });
    }

    return apiResponse(202, {
      ok: true,
      noticeId,
      projectId,
      imported: results.length,
      files: results,
    });
  } catch (err: any) {
    console.error('import-solicitation error:', err);
    return apiResponse(500, {
      message: 'Failed to import solicitation',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:create'))
    .use(httpErrorMiddleware()),
);
