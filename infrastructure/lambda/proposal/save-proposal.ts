import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { SaveProposalRequestSchema, } from '@auto-rfp/shared';
import { saveProposal } from '../helpers/proposal';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { safeParseJson } from '../helpers/safe-string';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const parsedBody = safeParseJson(event.body);
    if (parsedBody === null) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }
    const parsed = SaveProposalRequestSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const saved = await saveProposal(parsed.data);
    return apiResponse(200, saved);
  } catch (err) {
    console.error('Error in saveProposal handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware())
);