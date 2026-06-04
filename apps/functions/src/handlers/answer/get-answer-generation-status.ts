import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SFNClient, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import type { AnswerGenerationStatusResponse } from '@auto-rfp/core';

const ANSWER_GENERATION_STATE_MACHINE_ARN = process.env.ANSWER_GENERATION_STATE_MACHINE_ARN || '';

const sfnClient = new SFNClient({});

/**
 * Report whether the answer-generation Step Function is currently running for an
 * opportunity. This is the authoritative "is generation in flight" signal for
 * the question list — it covers cluster-copied questions that have no
 * QUESTION_FILE record, which a per-file status flag cannot.
 *
 * GET answer/generation-status/{id}?orgId=...&opportunityId=...
 *   → 200 { isGenerating: boolean, executionArn?: string }
 *
 * Best-effort by design: a missing state-machine ARN or any SFN failure returns
 * { isGenerating: false } rather than a 500, so a transient control-plane error
 * never breaks the polling UI.
 */
export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { id: projectId } = event.pathParameters ?? {};
  const { opportunityId } = event.queryStringParameters ?? {};

  if (!projectId) {
    return apiResponse(400, { message: 'Missing projectId' });
  }

  if (!opportunityId) {
    return apiResponse(400, { message: 'Missing opportunityId' });
  }

  // No state machine configured (e.g. env not wired) — treat as not generating.
  if (!ANSWER_GENERATION_STATE_MACHINE_ARN) {
    return apiResponse(200, { isGenerating: false } satisfies AnswerGenerationStatusResponse);
  }

  try {
    const executions = await sfnClient.send(
      new ListExecutionsCommand({
        stateMachineArn: ANSWER_GENERATION_STATE_MACHINE_ARN,
        statusFilter: 'RUNNING',
        maxResults: 100,
      }),
    );

    // Execution names are `${opportunityId}-${Date.now()}` (see
    // check-and-trigger-answers.ts), so a substring match on opportunityId
    // identifies the run for this opportunity.
    const runningForOpportunity = executions.executions?.find((e) => e.name?.includes(opportunityId));

    return apiResponse(200, {
      isGenerating: !!runningForOpportunity,
      ...(runningForOpportunity?.executionArn ? { executionArn: runningForOpportunity.executionArn } : {}),
    } satisfies AnswerGenerationStatusResponse);
  } catch (err) {
    // Best-effort — never surface a 500 for a status poll.
    console.error('get-answer-generation-status: failed to list executions:', err);
    return apiResponse(200, { isGenerating: false } satisfies AnswerGenerationStatusResponse);
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:generate'))
    .use(httpErrorMiddleware()),
);
