import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, parseJsonBody, getUserId } from '@/helpers/api';
import { createEmployee } from '@/helpers/employee';
import { EmployeeCreateRequestSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

/**
 * POST /employee/create — create an employee (BR2.2). Validation failures
 * return field-level issues so the form can mark the offending field (BR4.3).
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = parseJsonBody(event);

  const { success, data, error } = EmployeeCreateRequestSchema.safeParse(raw);
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const item = await createEmployee(data, { createdBy: getUserId(event) });

  setAuditContext(event, {
    action: 'EMPLOYEE_CREATED',
    resource: 'employee',
    resourceId: item.id,
    orgId: data.orgId,
    changes: { after: { name: item.name, source: item.source } },
  });

  return apiResponse(201, { item });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('employee:manage'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
