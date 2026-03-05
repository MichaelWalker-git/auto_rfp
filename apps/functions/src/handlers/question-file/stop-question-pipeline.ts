import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { SFNClient, StopExecutionCommand } from '@aws-sdk/client-sfn';

import { StopQuestionPipelineSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { getQuestionFileItem, updateQuestionFile } from '@/helpers/questionFile';

const sfnClient = new SFNClient({});

// Resolved lazily to avoid module-level env var issues in tests
const getStateMachineArn = () => requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');

const getStateMachineName = (arn: string): string | null => {
  const match = arn.match(/(?:stateMachine|execution):([^:]+)/);
  return match ? match[1] : null;
};

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  const { success, data, error } = StopQuestionPipelineSchema.safeParse(JSON.parse(event.body));
  if (!success) return apiResponse(400, { message: 'Validation failed', issues: error.issues });

  const { projectId, opportunityId, questionFileId } = data;

  const qf = await getQuestionFileItem(projectId, opportunityId, questionFileId);
  if (!qf) return apiResponse(404, { message: 'Question file not found' });

  const executionArn = qf.executionArn as string | undefined;

  if (!executionArn) {
    // No active execution — just mark as cancelled
    await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'CANCELLED' });

    setAuditContext(event, {
      action: 'PIPELINE_FAILED',
      resource: 'question_file',
      resourceId: questionFileId,
      changes: { after: { status: 'CANCELLED', reason: 'no_active_execution' } },
    });

    return apiResponse(200, { ok: true, message: 'Pipeline cancelled (no active execution found)' });
  }

  // Verify the execution belongs to the question pipeline
  const executionName = getStateMachineName(executionArn);
  const expectedName = getStateMachineName(getStateMachineArn());

  if (!executionName || executionName !== expectedName) {
    return apiResponse(403, { message: 'Invalid execution ARN — does not belong to question pipeline' });
  }

  try {
    await sfnClient.send(new StopExecutionCommand({
      executionArn,
      cause: 'User requested cancellation',
      error: 'UserCancellation',
    }));
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    const message = (err as { message?: string })?.message ?? '';
    // If execution already finished, still mark as cancelled
    if (name === 'ExecutionDoesNotExist' || message.includes('does not exist')) {
      await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'CANCELLED' });
      return apiResponse(200, { ok: true, message: 'Pipeline cancelled (execution already completed or not found)' });
    }
    throw err; // let httpErrorMiddleware handle unexpected errors
  }

  await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'CANCELLED' });

  setAuditContext(event, {
    action: 'PIPELINE_FAILED',
    resource: 'question_file',
    resourceId: questionFileId,
    changes: { after: { status: 'CANCELLED', executionArn } },
  });

  return apiResponse(200, { ok: true, message: 'Pipeline stopped successfully' });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
