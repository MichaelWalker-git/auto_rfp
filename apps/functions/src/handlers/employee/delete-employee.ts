import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { deleteEmployee } from '@/helpers/employee';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

/**
 * DELETE /employee/delete?orgId=...&id=... — physical removal from the pool.
 * Never blocked by saved plan-team references (BR3.1): consumers keep their
 * own name/role snapshot of the person.
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, id } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!id) return apiResponse(400, { message: 'id is required' });

  const deleted = await deleteEmployee(orgId, id);
  if (!deleted) return apiResponse(404, { message: 'Employee not found' });

  setAuditContext(event, {
    action: 'EMPLOYEE_DELETED',
    resource: 'employee',
    resourceId: id,
    orgId,
  });

  return apiResponse(200, { ok: true, id });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('employee:manage'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
