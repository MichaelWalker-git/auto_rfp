import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SecretsManagerClient, DeleteSecretCommand } from '@aws-sdk/client-secrets-manager';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';

const secretsClient = new SecretsManagerClient({});
const API_KEY_SECRET_PREFIX = 'samgov-api-key';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const secretName = `${API_KEY_SECRET_PREFIX}-${orgId}`;

    try {
      await secretsClient.send(
        new DeleteSecretCommand({
          SecretId: secretName,
          ForceDeleteWithoutRecovery: false, // Allow recovery within 30 days
        })
      );

      
    setAuditContext(event, {
      action: 'API_KEY_DELETED',
      resource: 'api_key',
      resourceId: 'samgov-api-key',
    });

    return apiResponse(200, {
        message: 'API key deleted successfully',
        orgId,
        note: 'The API key can be recovered within 30 days if needed',
      });
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        return apiResponse(404, { error: 'API key not found for this organization' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error deleting API key', error);
    return apiResponse(500, { error: 'Failed to delete API key' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);