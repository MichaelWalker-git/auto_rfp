import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { SFNClient, StopExecutionCommand } from '@aws-sdk/client-sfn';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import {
  authContextMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  httpErrorMiddleware,
} from '@/middleware/rbac-middleware';
import { updateQuestionFile, getQuestionFileItem } from '@/helpers/questionFile';

const sfnClient = new SFNClient({ region: 'us-east-1' });
const QUESTION_PIPELINE_STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');

type RequestBody = {
  projectId: string;
  opportunityId: string;
  questionFileId: string;
};

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is required' });
  }

  let body: RequestBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const { projectId, opportunityId, questionFileId } = body;

  if (!projectId || !opportunityId || !questionFileId) {
    return apiResponse(400, { 
      message: 'projectId, opportunityId, and questionFileId are required' 
    });
  }

  try {
    const qf = await getQuestionFileItem(projectId, opportunityId, questionFileId);
    
    if (!qf) {
      return apiResponse(404, { message: 'Question file not found' });
    }

    const executionArn = qf.executionArn as string | undefined;
    
    if (!executionArn) {
      console.log('No execution ARN found - just marking as cancelled');
      await updateQuestionFile(projectId, opportunityId, questionFileId, {
        status: 'CANCELLED',
      });
      
      return apiResponse(200, { 
        ok: true,
        message: 'Pipeline cancelled (no active execution found)',
      });
    }

    const getStateMachineName = (arn: string) => {
      const match = arn.match(/(?:stateMachine|execution):([^:]+)/);
      return match ? match[1] : null;
    };

    const executionStateMachineName = getStateMachineName(executionArn);
    const expectedStateMachineName = getStateMachineName(QUESTION_PIPELINE_STATE_MACHINE_ARN);

    // Verify the execution belongs to the question pipeline
    if (!executionStateMachineName || executionStateMachineName !== expectedStateMachineName) {
      console.error('Execution ARN mismatch:', {
        executionArn,
        executionStateMachineName,
        expectedStateMachineName,
        stateMachineArn: QUESTION_PIPELINE_STATE_MACHINE_ARN
      });
      return apiResponse(403, { 
        message: 'Invalid execution ARN - does not belong to question pipeline' 
      });
    }

    await sfnClient.send(new StopExecutionCommand({
      executionArn: executionArn,
      cause: 'User requested cancellation',
      error: 'UserCancellation',
    }));

    await updateQuestionFile(projectId, opportunityId, questionFileId, {
      status: 'CANCELLED',
    });

    return apiResponse(200, {
      ok: true,
      message: 'Pipeline stopped successfully',
    });
  } catch (error: any) {
    console.error('Error stopping execution:', error);
    
    // If execution not found or already stopped, still mark as cancelled
    if (error.name === 'ExecutionDoesNotExist' || error.message?.includes('does not exist')) {
      await updateQuestionFile(projectId, opportunityId, questionFileId, {
        status: 'CANCELLED',
      });
      
      return apiResponse(200, {
        ok: true,
        message: 'Pipeline cancelled (execution already completed or not found)',
      });
    }
    
    return apiResponse(500, {
      message: 'Failed to stop pipeline execution',
      error: error.message,
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:delete'))
    .use(httpErrorMiddleware()),
);