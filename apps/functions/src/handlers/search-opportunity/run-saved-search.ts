import type { EventBridgeEvent } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';

import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { nowIso } from '@/helpers/date';

import {
  type LoadSearchOpportunitiesRequest,
  type OpportunityItem,
  type SavedSearch,
  SavedSearchSchema,
  dibbsSlimToSearchOpportunity,
} from '@auto-rfp/core';

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
  searchDibbsOpportunities,
  toBoolActive,
} from '@/helpers/search-opportunity';
import {
  fetchDibbsSolicitation,
  extractDibbsAttachments,
  type DibbsSearchConfig,
} from '@/helpers/search-opportunity';
import { listAllOrgIds } from '@/helpers/org';
import { PROJECT_PK } from '@/constants/organization';
import { uploadToS3 } from '@/helpers/s3';
import { SAM_GOV_SECRET_PREFIX, SAVED_SEARCH_PK } from '@/constants/samgov';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import { buildQuestionFileSK, updateQuestionFile } from '@/helpers/questionFile';
import { createOpportunity } from '@/helpers/opportunity';
import { getApiKey } from '@/helpers/api-key-storage';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');

const SAM_BASE_URL = requireEnv('SAM_OPPS_BASE_URL', 'https://api.sam.gov');
const SAM_API_ORIGIN = requireEnv('SAM_API_ORIGIN', 'https://api.sam.gov');

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

function buildRuntimeCriteria(search: SavedSearch, now: Date): LoadSearchOpportunitiesRequest {
  const base = search.criteria;
  const postedTo = mmddyyyy(now);

  // Use last run time as postedFrom for incremental fetching; fall back to saved criteria or 30 days ago
  let postedFrom: string;
  if (search.lastRunAt) {
    const last = new Date(search.lastRunAt);
    postedFrom = Number.isNaN(last.getTime()) ? (base.postedFrom ?? mmddyyyy(new Date(now.getTime() - 30 * 86_400_000))) : mmddyyyy(last);
  } else {
    postedFrom = base.postedFrom ?? mmddyyyy(new Date(now.getTime() - 30 * 86_400_000));
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
  });
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
  const apiKey = await getApiKey(orgId, SAM_GOV_SECRET_PREFIX);
  if (!apiKey) {
    return 0;
  }
  const oppRaw = await fetchOpportunityViaSearch(args.samCfg, {
    noticeId: args.noticeId,
    postedFrom: args.postedFrom,
    postedTo: args.postedTo,
    apiKey
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
    setAside: ((oppRaw as any)?.setAside ?? null) as any,
    description: ((oppRaw as any)?.description ?? null) as any,
    active: toBoolActive((oppRaw as any)?.active),
    baseAndAllOptionsValue: ((oppRaw as any)?.baseAndAllOptionsValue ?? null) as any,
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
    console.log('criteria ', criteria, 'source', s.source);

    const source = s.source ?? 'SAM_GOV';
    let found = 0;
    let importedQuestionFiles = 0;
    let skippedAutoImport = false;

    if (source === 'SAM_GOV') {
      const samApiKey = await getApiKey(args.orgId, SAM_GOV_SECRET_PREFIX);
      if (!samApiKey) {
        console.log(`No SAM.gov API key for org ${args.orgId}, skipping search ${s.savedSearchId}`);
        continue;
      }

      const resp = await searchSamOpportunities(
        { baseUrl: SAM_BASE_URL, apiKey: samApiKey, httpsAgent },
        criteria,
      );
      const opportunities = resp.opportunities ?? [];
      found = opportunities.length;
      const noticeIds = opportunities.map((o) => o.noticeId).filter(Boolean) as string[];

      if (!args.dryRun && s.autoImport) {
        if (!projectId) {
          skippedAutoImport = true;
        } else {
          const cap = Math.min(noticeIds.length, 25);
          const postedFrom = criteria.postedFrom ?? mmddyyyy(new Date(args.now.getTime() - 30 * 86_400_000));
          const postedTo = criteria.postedTo ?? mmddyyyy(args.now);
          for (let i = 0; i < cap; i++) {
            importedQuestionFiles += await importNoticeUsingHelpers({
              orgId: args.orgId,
              projectId,
              noticeId: noticeIds[i]!,
              postedFrom,
              postedTo,
              samCfg: args.samImportCfg,
            });
          }
        }
      }
    } else if (source === 'DIBBS') {
      const dibbsApiKey = await getApiKey(args.orgId, DIBBS_SECRET_PREFIX);
      if (!dibbsApiKey) {
        console.log(`No DIBBS API key for org ${args.orgId}, skipping search ${s.savedSearchId}`);
        continue;
      }

      const dibbsBaseUrl = requireEnv('DIBBS_BASE_URL', 'https://www.dibbs.bsm.dla.mil');
      const dibbsCfg: DibbsSearchConfig = { baseUrl: dibbsBaseUrl, apiKey: dibbsApiKey, httpsAgent };

      const resp = await searchDibbsOpportunities(dibbsCfg, {
        keywords:    criteria.keywords,
        naics:       criteria.naics,
        setAsideCode: criteria.setAsideCode,
        postedFrom:  criteria.postedFrom,
        postedTo:    criteria.postedTo,
        closingFrom: criteria.closingFrom,
        closingTo:   criteria.closingTo,
        limit:       criteria.limit ?? 25,
        offset:      0,
      });
      const opportunities = resp.opportunities ?? [];
      found = opportunities.length;

      if (!args.dryRun && s.autoImport && projectId) {
        const cap = Math.min(opportunities.length, 25);
        for (let i = 0; i < cap; i++) {
          const opp = opportunities[i]!;
          if (!opp.solicitationNumber) continue;
          try {
            const oppRaw = await fetchDibbsSolicitation(dibbsCfg, opp.solicitationNumber);
            const attachments = extractDibbsAttachments(oppRaw);
            const slim = dibbsSlimToSearchOpportunity(opp);
            const { oppId } = await createOpportunity({
              orgId: args.orgId,
              projectId,
              opportunity: {
                orgId: args.orgId,
                projectId,
                source: 'DIBBS',
                id: opp.solicitationNumber,
                title: slim.title,
                type: slim.type,
                postedDateIso: slim.postedDate ? new Date(slim.postedDate).toISOString() : null,
                responseDeadlineIso: slim.closingDate ? new Date(slim.closingDate).toISOString() : null,
                noticeId: null,
                solicitationNumber: opp.solicitationNumber,
                naicsCode: slim.naicsCode,
                pscCode: (oppRaw as any)?.pscCode ?? null,
                organizationName: slim.organizationName,
                setAside: slim.setAside,
                description: slim.description,
                active: slim.active,
                baseAndAllOptionsValue: slim.baseAndAllOptionsValue,
              },
            });
            for (const a of attachments) {
              const filename = buildAttachmentFilename(a);
              const fileKey = buildAttachmentS3Key({
                orgId: args.orgId,
                projectId,
                noticeId: opp.solicitationNumber,
                attachmentUrl: a.url,
                filename,
              });
              const { buf, contentType } = await httpsGetBuffer(new URL(a.url), { httpsAgent });
              const ct = a.mimeType || contentType || guessContentType(filename);
              await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, ct);
              const { questionFileId } = await createQuestionFile({ projectId, fileKey, oppId, originalFileName: filename, mimeType: ct });
              await markProcessing(projectId, questionFileId, oppId);
              await startPipeline(projectId, questionFileId, oppId);
              importedQuestionFiles++;
            }
          } catch (e) {
            console.error(`Failed to import DIBBS solicitation ${opp.solicitationNumber}:`, e);
          }
        }
      } else if (!args.dryRun && s.autoImport && !projectId) {
        skippedAutoImport = true;
      }
    }

    if (!args.dryRun) {
      await updateLastRunAt(args.orgId, s.savedSearchId, args.ranAtIso);
    }

    out.push({
      savedSearchId: s.savedSearchId,
      source,
      name: s.name,
      frequency: s.frequency,
      autoImport: s.autoImport,
      projectId: projectId ?? null,
      skippedAutoImport,
      found,
      importedQuestionFiles,
    });
  }

  return out;
}

export const baseHandler = async (event: RunnerEvent) => {
  const dryRun = Boolean(event.detail?.dryRun);
  const onlyOrgId = event.detail?.orgId;
  console.log('Event: ', JSON.stringify(event));
  const now = new Date();
  const ranAtIso = nowIso();

  const samImportCfg: ImportSamConfig = {
    samApiOrigin: SAM_API_ORIGIN,
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