import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { withSentryLambda } from '../sentry-lambda';
import { apiResponse, getOrgId } from '../helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';

const sfnClient = new SFNClient({});
const STATE_MACHINE_ARN = requireEnv('STATE_MACHINE_ARN');

interface StartPipelineRequestBody {
  knowledgeBaseId: string;
  documentId?: string;
  orgId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('start-document-pipeline event:', JSON.stringify(event));

  const body: StartPipelineRequestBody = JSON.parse(event.body || '');

  const { documentId, knowledgeBaseId, orgId: bodyOrgId } = body;
  if (!documentId || !knowledgeBaseId) {
    return apiResponse(400, { message: 'documentId and knowledgeBaseId are required' });
  }

  const orgId = bodyOrgId ? bodyOrgId : getOrgId(event);

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const input = {
    orgId,
    documentId,
    knowledgeBaseId
  };

  try {
    const startRes = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify(input),
      }),
    );

    return apiResponse(202, {
      message: 'Document pipeline started',
      executionArn: startRes.executionArn,
      startDate: startRes.startDate,
    });
  } catch (err) {
    console.error('Error starting state machine:', err);
    return apiResponse(500, {
      message: 'Failed to start document pipeline',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:create'))
    .use(httpErrorMiddleware())
);
