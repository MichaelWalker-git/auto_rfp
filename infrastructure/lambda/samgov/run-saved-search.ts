import type { EventBridgeEvent } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';

import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { nowIso } from '../helpers/date';
import { readPlainSecret } from '../helpers/secret';

import {
  type LoadSamOpportunitiesRequest,
  type OpportunityItem,
  type SavedSearch,
  SavedSearchSchema,
} from '@auto-rfp/shared';

import {
  buildAttachmentFilename,
  buildAttachmentS3Key,
  extractAttachmentsFromOpportunity,
  fetchOpportunityViaSearch,
  guessContentType,
  httpsGetBuffer,
  type ImportSamConfig,
  safeIsoOrNull,
  searchSamOpportunities,
  toBoolActive,
} from '../helpers/samgov';
import { listAllOrgIds } from '../helpers/org';
import { PROJECT_PK } from '../constants/organization';
import { uploadToS3 } from '../helpers/s3';
import { SAVED_SEARCH_PK } from '../constants/samgov';
import { buildQuestionFileSK, updateQuestionFile } from '../helpers/questionFile';
import { createOpportunity } from '../helpers/opportunity';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');

const SAM_BASE_URL = requireEnv('SAM_OPPS_BASE_URL', 'https://api.sam.gov');
const SAM_API_ORIGIN = requireEnv('SAM_API_ORIGIN', 'https://api.sam.gov');
const SAM_GOV_API_KEY_SECRET_ID = requireEnv('SAM_GOV_API_KEY_SECRET_ID');

const httpsAgent = new https.Agent({ keepAlive: true });
const sfn = new SFNClient({});

type RunnerEvent = EventBridgeEvent<'sam.runSavedSearches', { dryRun?: boolean; orgId?: string }>;

function mmddyyyy(d: Date) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function shouldRunNow(search: SavedSearch, now: Date) {
  if (!search.isEnabled) return false;

  const last = search.lastRunAt ? new Date(search.lastRunAt) : null;
  if (!last) return true;

  const ms = now.getTime() - last.getTime();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const week = 7 * day;

  if (search.frequency === 'HOURLY') return ms >= hour;
  if (search.frequency === 'DAILY') return ms >= day;
  if (search.frequency === 'WEEKLY') return ms >= week;
  return ms >= day;
}

function buildRuntimeCriteria(search: SavedSearch, now: Date): LoadSamOpportunitiesRequest {
  const base = search.criteria;
  const postedTo = mmddyyyy(now);

  let postedFrom = base.postedFrom;
  if (search.lastRunAt) {
    const last = new Date(search.lastRunAt);
    if (!Number.isNaN(last.getTime())) postedFrom = mmddyyyy(last);
  }

  return {
    ...base,
    postedFrom,
    postedTo,
    limit: base.limit ?? 25,
    offset: 0,
  };
}

export async function getOrgDefaultProjectId(orgId: string): Promise<string | null> {
  let ExclusiveStartKey: Record<string, any> | undefined;
  let best: { projectId: string; createdAtMs: number } | null = null;
  const MAX_PAGES = 10;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: {
          ':pk': PROJECT_PK,
          ':prefix': `${orgId}#`,
        },
        ProjectionExpression: 'projectId, createdAt',
        ExclusiveStartKey,
        Limit: 100,
      }),
    );

    for (const it of res.Items ?? []) {
      const projectId = String((it as any)?.projectId ?? '').trim();
      if (!projectId) continue;

      const createdAt = String((it as any)?.createdAt ?? '').trim();
      const ms = Date.parse(createdAt);
      if (!Number.isFinite(ms)) continue;

      if (!best || ms > best.createdAtMs) best = { projectId, createdAtMs: ms };
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
    if (!ExclusiveStartKey) break;
  }

  return best?.projectId ?? null;
}

async function listSavedSearchesForOrg(orgId: string): Promise<SavedSearch[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': SAVED_SEARCH_PK, ':prefix': `${orgId}#` },
    }),
  );

  const out: SavedSearch[] = [];
  for (const it of res.Items ?? []) {
    const parsed = SavedSearchSchema.safeParse(it);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

async function updateLastRunAt(orgId: string, savedSearchId: string, runAtIso: string) {
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: SAVED_SEARCH_PK, [SK_NAME]: `${orgId}#${savedSearchId}` },
      UpdateExpression: 'SET #lastRunAt = :t, #updatedAt = :t',
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
        '#lastRunAt': 'lastRunAt',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: { ':t': runAtIso },
    }),
  );
}

async function createQuestionFile(args: {
  projectId: string;
  fileKey: string;
  oppId: string;
  originalFileName?: string;
  mimeType?: string;
  sourceDocumentId?: string;
}) {
  const { projectId, oppId } = args;
  const now = nowIso();
  const questionFileId = uuidv4();
  const sk = buildQuestionFileSK(projectId, oppId, questionFileId);

  const item: Record<string, any> = {
    [PK_NAME]: QUESTION_FILE_PK,
    [SK_NAME]: sk,

    oppId,
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

async function markProcessing(projectId: string, oppId: string, questionFileId: string) {
  await updateQuestionFile(projectId, oppId, questionFileId, {
    status: 'PROCESSING',
  })
}

async function startPipeline(projectId: string, questionFileId: string, oppId: string) {
  const res = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({ questionFileId, projectId, oppId }),
    }),
  );

  return { executionArn: res.executionArn, startDate: res.startDate };
}

async function importNoticeUsingHelpers(args: {
  orgId: string;
  projectId: string;
  noticeId: string;
  postedFrom: string;
  postedTo: string;
  samCfg: ImportSamConfig;
}) {
  const { orgId, projectId, noticeId } = args;
  const oppRaw = await fetchOpportunityViaSearch(args.samCfg, {
    noticeId: args.noticeId,
    postedFrom: args.postedFrom,
    postedTo: args.postedTo,
  });
  const attachments = extractAttachmentsFromOpportunity(oppRaw);

  const opportunity: OpportunityItem = {
    orgId,
    projectId,
    source: 'SAM_GOV',
    id: noticeId,
    title: String((oppRaw as any)?.title ?? 'Untitled'),
    type: ((oppRaw as any)?.type ?? null) as any,
    postedDateIso: safeIsoOrNull((oppRaw as any)?.postedDate),
    responseDeadlineIso: safeIsoOrNull((oppRaw as any)?.responseDeadLine),
    noticeId: ((oppRaw as any)?.noticeId ?? noticeId) as any,
    solicitationNumber: ((oppRaw as any)?.solicitationNumber ?? null) as any,
    naicsCode: ((oppRaw as any)?.naicsCode ?? null) as any,
    pscCode: ((oppRaw as any)?.classificationCode ?? null) as any,
    organizationName: ((oppRaw as any)?.organizationName ?? (oppRaw as any)?.fullParentPathName ?? null) as any,
    organizationCode: ((oppRaw as any)?.organizationCode ?? (oppRaw as any)?.fullParentPathCode ?? null) as any,
    setAside: ((oppRaw as any)?.setAside ?? null) as any,
    setAsideCode: ((oppRaw as any)?.setAsideCode ?? null) as any,
    description: ((oppRaw as any)?.description ?? null) as any,
    active: toBoolActive((oppRaw as any)?.active),
    baseAndAllOptionsValue: ((oppRaw as any)?.baseAndAllOptionsValue ?? null) as any,
    raw: {
      noticeId: (oppRaw as any)?.noticeId ?? noticeId,
      solicitationNumber: (oppRaw as any)?.solicitationNumber,
      title: (oppRaw as any)?.title,
      type: (oppRaw as any)?.type,
      postedDate: (oppRaw as any)?.postedDate,
      responseDeadLine: (oppRaw as any)?.responseDeadLine,
      naicsCode: (oppRaw as any)?.naicsCode,
      classificationCode: (oppRaw as any)?.classificationCode,
      active: (oppRaw as any)?.active,
      setAside: (oppRaw as any)?.setAside,
      setAsideCode: (oppRaw as any)?.setAsideCode,
      fullParentPathName: (oppRaw as any)?.fullParentPathName,
      fullParentPathCode: (oppRaw as any)?.fullParentPathCode,
      description: (oppRaw as any)?.description,
      baseAndAllOptionsValue: (oppRaw as any)?.baseAndAllOptionsValue,
      award: (oppRaw as any)?.award,
      attachmentsCount: attachments.length,
    },
  };

  const { oppId } = await createOpportunity({
    orgId,
    projectId,
    opportunity,
  });

  console.log(oppRaw);

  console.log(attachments);

  if (!attachments.length) return 0;

  let imported = 0;

  for (const a of attachments) {
    const filename = buildAttachmentFilename(a);

    const fileKey = buildAttachmentS3Key({
      orgId: args.orgId,
      projectId: args.projectId,
      noticeId: args.noticeId,
      attachmentUrl: a.url,
      filename,
    });

    const { buf, contentType } = await httpsGetBuffer(new URL(a.url), { httpsAgent });
    const finalContentType = a.mimeType || contentType || guessContentType(filename);

    await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, finalContentType);


    const { questionFileId } = await createQuestionFile({
      projectId: args.projectId,
      fileKey,
      oppId,
      originalFileName: filename,
      mimeType: finalContentType,
    });

    await markProcessing(args.projectId, questionFileId, oppId);
    await startPipeline(args.projectId, questionFileId, oppId);

    imported++;
  }

  return imported;
}

async function runForOrg(args: {
  orgId: string;
  now: Date;
  ranAtIso: string;
  apiKey: string;
  samImportCfg: ImportSamConfig;
  dryRun: boolean;
}) {
  const searches = await listSavedSearchesForOrg(args.orgId);
  console.log('searches ', searches);
  const projectId = await getOrgDefaultProjectId(args.orgId);
  console.log('projectId ', projectId);

  const out: any[] = [];

  for (const s of searches) {
    if (!shouldRunNow(s, args.now)) continue;

    const criteria = buildRuntimeCriteria(s, args.now);
    console.log('criteria ', criteria);

    const resp = await searchSamOpportunities(
      { baseUrl: SAM_BASE_URL, apiKey: args.apiKey, httpsAgent },
      criteria,
    );

    const opportunities = resp.opportunities ?? [];
    console.log('opportunities ', opportunities);
    const noticeIds = opportunities.map((o) => o.noticeId).filter(Boolean) as string[];
    console.log('noticeIds ', noticeIds);
    let importedQuestionFiles = 0;
    let skippedAutoImport = false;

    if (!args.dryRun && s.autoImport) {
      if (!projectId) {
        skippedAutoImport = true;
      } else {
        const cap = Math.min(noticeIds.length, 25);
        for (let i = 0; i < cap; i++) {
          importedQuestionFiles += await importNoticeUsingHelpers({
            orgId: args.orgId,
            projectId,
            noticeId: noticeIds[i],
            postedFrom: criteria.postedFrom,
            postedTo: criteria.postedTo,
            samCfg: args.samImportCfg,
          });
        }
      }
    }

    if (!args.dryRun) {
      await updateLastRunAt(args.orgId, s.savedSearchId, args.ranAtIso);
    }

    out.push({
      savedSearchId: s.savedSearchId,
      name: s.name,
      frequency: s.frequency,
      autoImport: s.autoImport,
      projectId: projectId ?? null,
      skippedAutoImport,
      searchedPostedFrom: criteria.postedFrom,
      searchedPostedTo: criteria.postedTo,
      found: opportunities.length,
      importedQuestionFiles,
    });
  }

  return out;
}

export const baseHandler = async (event: RunnerEvent) => {
  const dryRun = Boolean(event.detail?.dryRun);
  const onlyOrgId = event.detail?.orgId;
  console.log('Event: ', JSON.stringify(event));
  const oppId = '';
  const now = new Date();
  const ranAtIso = nowIso();

  const apiKey = await readPlainSecret(SAM_GOV_API_KEY_SECRET_ID);

  const samImportCfg: ImportSamConfig = {
    samApiOrigin: SAM_API_ORIGIN,
    samApiKeySecretId: SAM_GOV_API_KEY_SECRET_ID,
    httpsAgent,
  };

  const orgIds = onlyOrgId ? [onlyOrgId] : await listAllOrgIds();

  console.log('orgIds: ', orgIds);

  const resultsByOrg: Array<{ orgId: string; results: any[] }> = [];

  // Sequential to be safe with SAM throttling; can add concurrency later.
  for (const orgId of orgIds) {
    const results = await runForOrg({
      orgId,
      now,
      ranAtIso,
      apiKey,
      samImportCfg,
      dryRun,
    });

    if (results.length) resultsByOrg.push({ orgId, results });
  }

  return {
    ok: true,
    dryRun,
    ranAt: ranAtIso,
    orgCount: orgIds.length,
    orgsWithWork: resultsByOrg.length,
    resultsByOrg,
  };
};

export const handler = withSentryLambda(middy(baseHandler));