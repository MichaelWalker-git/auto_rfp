import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
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

import {
  buildAttachmentFilename,
  buildAttachmentS3Key,
  extractAttachmentsFromOpportunity,
  fetchOpportunityViaSearch,
  guessContentType,
  httpsGetBuffer,
  type ImportSamConfig,
} from '../helpers/samgov';
import { uploadToS3 } from '../helpers/s3';
import { nowIso } from '../helpers/date';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const SAM_API_ORIGIN = process.env.SAM_API_ORIGIN || 'https://api.sam.gov';
const SAM_GOV_API_KEY_SECRET_ID = requireEnv('SAM_GOV_API_KEY_SECRET_ID');

const sfn = new SFNClient({});
const httpsAgent = new https.Agent({ keepAlive: true });

type ImportSolicitationBody = {
  orgId: string;
  projectId: string;
  noticeId: string;
  postedFrom: string; // MM/dd/yyyy
  postedTo: string;   // MM/dd/yyyy
  sourceDocumentId?: string;
};

async function createQuestionFile(args: {
  projectId: string;
  fileKey: string;
  originalFileName?: string;
  mimeType?: string;
  sourceDocumentId?: string;
}) {
  const now = nowIso()
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

  const samCfg: ImportSamConfig = {
    samApiOrigin: SAM_API_ORIGIN,
    samApiKeySecretId: SAM_GOV_API_KEY_SECRET_ID,
    httpsAgent,
  };

  try {
    const opp = await fetchOpportunityViaSearch(samCfg, { noticeId, postedFrom, postedTo });
    console.log('Opportunity', opp);
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