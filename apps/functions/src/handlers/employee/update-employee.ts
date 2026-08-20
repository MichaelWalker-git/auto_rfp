import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, parseJsonBody } from '@/helpers/api';
import { isConditionalCheckFailed } from '@/helpers/db';
import { updateEmployee } from '@/helpers/employee';
import { EmployeeUpdateRequestSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const UpdateEmployeeBodySchema = z.object({
  orgId: z.string().min(1),
  id: z.string().min(1),
  patch: EmployeeUpdateRequestSchema,
});

/**
 * PATCH /employee/update — partial edit; identity is immutable (BR3.2).
 * Field-level validation issues come back on 400 (BR4.3); a record missing
 * from this org is a 404 (BR2.3).
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = parseJsonBody(event);

  const { success, data, error } = UpdateEmployeeBodySchema.safeParse(raw);
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  try {
    const item = await updateEmployee(data.orgId, data.id, data.patch);

    setAuditContext(event, {
      action: 'EMPLOYEE_UPDATED',
      resource: 'employee',
      resourceId: data.id,
      orgId: data.orgId,
      changes: { after: data.patch },
    });

    return apiResponse(200, { item });
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      return apiResponse(404, { message: 'Employee not found' });
    }
    throw err;
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('employee:manage'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
