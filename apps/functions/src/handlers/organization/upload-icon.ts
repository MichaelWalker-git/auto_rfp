import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { validateIconInput, generateIconUploadUrl, saveIconToOrg } from '@/helpers/org-icon';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const { contentType, fileSizeBytes } = JSON.parse(event.body);

    const validationError = validateIconInput({ orgId, contentType, fileSizeBytes });
    if (validationError) return apiResponse(400, { message: validationError });

    const result = await generateIconUploadUrl({ orgId, contentType, fileSizeBytes });
    await saveIconToOrg(orgId, result.iconKey);

    
    setAuditContext(event, {
      action: 'ORG_SETTINGS_CHANGED',
      resource: 'organization',
      resourceId: event.pathParameters?.orgId ?? event.queryStringParameters?.orgId ?? 'unknown',
    });

    return apiResponse(200, {
      ok: true,
      upload: {
        url: result.uploadUrl,
        method: 'PUT',
        bucket: result.bucket,
        key: result.iconKey,
        expiresIn: result.expiresIn,
      },
      iconUrl: result.iconUrl,
      iconKey: result.iconKey,
    });
  } catch (err) {
    console.error('Error in upload-icon:', err);
    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }
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
    .use(requirePermission('org:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);