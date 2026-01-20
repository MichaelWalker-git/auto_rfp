import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

import { apiResponse, getOrgId } from '../helpers/api';
import { requireEnv } from '../helpers/env';

import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

import {
  buildAttachmentFilename,
  buildAttachmentS3Key,
  extractAttachmentsFromOpportunity,
  fetchOpportunityViaSearch,
  guessContentType,
  httpsGetBuffer,
  type ImportSamConfig, safeIsoOrNull, toBoolActive,
} from '../helpers/samgov';
import { uploadToS3 } from '../helpers/s3';

import { createOpportunity } from '../helpers/opportunity';

import type { OpportunityItem } from '@auto-rfp/shared';
import { createQuestionFile } from '../helpers/questionFile';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');
const SAM_API_ORIGIN = process.env.SAM_API_ORIGIN || 'https://api.sam.gov';
const SAM_GOV_API_KEY_SECRET_ID = requireEnv('SAM_GOV_API_KEY_SECRET_ID');

const sfn = new SFNClient({});
const httpsAgent = new https.Agent({ keepAlive: true });

type ImportSolicitationBody = {
  projectId: string;
  noticeId: string;
  postedFrom: string;
  postedTo: string;
  sourceDocumentId?: string;
};

async function startPipeline(projectId: string, questionFileId: string) {
  const res = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({ questionFileId, projectId }),
    }),
  );

  return { executionArn: res.executionArn, startDate: res.startDate };
}

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { ok: false, error: 'Request body is required' });

  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(401, { ok: false, error: 'Unauthorized' });

  let body: ImportSolicitationBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { projectId, noticeId, postedFrom, postedTo } = body;

  if (!projectId || !noticeId || !postedFrom || !postedTo) {
    return apiResponse(400, {
      ok: false,
      error: 'projectId, noticeId, postedFrom, postedTo are required',
    });
  }

  const samCfg: ImportSamConfig = {
    samApiOrigin: SAM_API_ORIGIN,
    samApiKeySecretId: SAM_GOV_API_KEY_SECRET_ID,
    httpsAgent,
  };

  try {
    const oppRaw = await fetchOpportunityViaSearch(samCfg, { noticeId, postedFrom, postedTo });
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

    const createdOpp = await createOpportunity({
      orgId,
      projectId,
      opportunity,
    });

    const oppId = createdOpp.oppId;

    const files: Array<{
      questionFileId: string;
      fileKey: string;
      originalFileName?: string | null;
      executionArn?: string;
      url: string;
      mimeType?: string | null;
    }> = [];

    for (const a of attachments) {
      const filename = buildAttachmentFilename(a);

      const fileKey = buildAttachmentS3Key({
        orgId,
        projectId,
        noticeId,
        attachmentUrl: a.url,
        filename,
      });

      const { buf, contentType } = await httpsGetBuffer(new URL(a.url), { httpsAgent });
      const finalContentType = a.mimeType || contentType || guessContentType(filename);

      await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, finalContentType);

      const qf = await createQuestionFile(orgId, {
        oppId,
        projectId,
        fileKey,
        originalFileName: filename,
        mimeType: finalContentType,
        sourceDocumentId: body.sourceDocumentId,
      });

      const started = await startPipeline(projectId, qf.questionFileId);

      files.push({
        questionFileId: qf.questionFileId,
        fileKey,
        originalFileName: filename,
        mimeType: qf.mimeType ?? null,
        executionArn: started.executionArn,
        url: a.url,
      });
    }

    return apiResponse(202, {
      ok: true,
      projectId,
      noticeId,
      opportunityId: oppId,
      imported: files.length,
      opportunity: createdOpp.item,
      files,
    });
  } catch (err: any) {
    console.error('import-solicitation error:', err);
    return apiResponse(500, {
      ok: false,
      error: 'Failed to import solicitation',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:create'))
    .use(requirePermission('opportunity:create'))
    .use(httpErrorMiddleware()),
);