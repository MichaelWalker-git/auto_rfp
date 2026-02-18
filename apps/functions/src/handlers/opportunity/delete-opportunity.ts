import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { deleteOpportunity } from '@/helpers/opportunity';
import { listQuestionFilesByOpportunity, deleteQuestionFile } from '@/helpers/questionFile';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EXEC_BRIEF_PK } from '@/constants/exec-brief';

const S3_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const s3Client = new S3Client({});

/**
 * Delete opportunity and cascade delete related question files and S3 objects
 */
const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    console.log('Delete Opportunity Event:', JSON.stringify(event, null, 2));

    const { projectId, oppId, orgId } = event.queryStringParameters ?? {};

    if (!orgId || !projectId || !oppId) {
      return apiResponse(400, {
        ok: false,
        error: 'Missing required parameters: projectId, oppId, orgId',
      });
    }

    // Step 1: Find all question files associated with this opportunity
    console.log(`Finding question files for opportunity: ${oppId}`);
    const { items: questionFiles } = await listQuestionFilesByOpportunity({
      projectId,
      oppId,
    });

    // Step 2: Delete S3 objects for each question file
    console.log(`Deleting ${questionFiles.length} S3 objects`);
    if (questionFiles.length > 0) {
      const objectsToDelete = [];

      for (const qf of questionFiles) {
        if (qf.fileKey) objectsToDelete.push({ Key: qf.fileKey });
        if (qf.textFileKey) objectsToDelete.push({ Key: qf.textFileKey });
      }

      if (objectsToDelete.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: S3_BUCKET,
            Delete: {
              Objects: objectsToDelete,
            },
          }),
        );
        console.log(`Deleted ${objectsToDelete.length} S3 objects`);
      }

      // Step 3: Delete question files from database
      console.log(`Deleting ${questionFiles.length} question file records`);
      for (const qf of questionFiles) {
        if (qf.questionFileId) {
          await deleteQuestionFile({
            projectId,
            oppId,
            questionFileId: qf.questionFileId,
          });
        }
      }
    }

    // Step 4: Delete executive briefs associated with this opportunity
    console.log(`Finding executive briefs for opportunity: ${oppId}`);
    let deletedBriefsCount = 0;
    try {
      // Query for executive briefs by projectId and filter by opportunityId
      const briefsRes = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
            '#sk': SK_NAME,
          },
          ExpressionAttributeValues: {
            ':pk': EXEC_BRIEF_PK,
            ':skPrefix': `${projectId}#`,
          },
        }),
      );

      const briefsToDelete = (briefsRes.Items || []).filter(
        (item: any) => item.opportunityId === oppId
      );

      console.log(`Found ${briefsToDelete.length} executive briefs to delete`);

      for (const brief of briefsToDelete) {
        await docClient.send(
          new DeleteCommand({
            TableName: DB_TABLE_NAME,
            Key: {
              [PK_NAME]: brief[PK_NAME],
              [SK_NAME]: brief[SK_NAME],
            },
          }),
        );
        deletedBriefsCount++;
      }
      console.log(`Deleted ${deletedBriefsCount} executive briefs`);
    } catch (briefErr) {
      console.warn('Error deleting executive briefs (continuing):', briefErr);
    }

    // Step 5: Delete the opportunity itself
    console.log(`Deleting opportunity: ${oppId}`);
    await deleteOpportunity({
      orgId,
      projectId,
      oppId,
    });

    return apiResponse(200, {
      ok: true,
      message: `Opportunity ${oppId}, ${questionFiles.length} question files, and ${deletedBriefsCount} executive briefs deleted`,
    });
  } catch (err: any) {
    console.error('Delete opportunity error:', err);
    return apiResponse(500, {
      ok: false,
      error: err?.message ?? 'Internal Server Error',
    });
  }
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:delete')),
);