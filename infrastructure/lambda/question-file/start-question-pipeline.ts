import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const sfnClient = new SFNClient({});

const STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

interface StartBody {
  questionFileId?: string;
  projectId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('start-question-pipeline event:', JSON.stringify(event));

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is required' });
  }

  let body: StartBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const { questionFileId, projectId } = body;

  if (!questionFileId || !projectId) {
    return apiResponse(400, {
      message: 'questionFileId and projectId are required',
    });
  }

  const sk = `${projectId}#${questionFileId}`;
  const now = new Date().toISOString();

  try {
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

    // 2) Start Step Functions execution
    const res = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify({
          questionFileId,
          projectId,
        }),
      }),
    );

    return apiResponse(202, {
      message: 'Question pipeline started',
      executionArn: res.executionArn,
      startDate: res.startDate,
    });
  } catch (err: any) {
    console.error('Error starting question pipeline:', err);
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Question file not found' });
    }
    return apiResponse(500, {
      message: 'Failed to start question pipeline',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);