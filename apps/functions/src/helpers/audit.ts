import { nowIso } from './date';

/**
 * Base audit fields that every DynamoDB entity should include.
 * - createdAt / updatedAt: ISO timestamps
 * - createdBy / updatedBy: user sort key (Cognito sub)
 */
export interface AuditFields {
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

/**
 * Generate audit fields for a new entity creation.
 */
export function createAuditFields(userId: string): AuditFields {
  const now = nowIso();
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  };
}

/**
 * Generate audit fields for an entity update.
 * Only updates `updatedAt` and `updatedBy`.
 */
export function updateAuditFields(userId: string): Pick<AuditFields, 'updatedAt' | 'updatedBy'> {
  return {
    updatedAt: nowIso(),
    updatedBy: userId,
  };
}

/**
 * DynamoDB UpdateExpression parts for setting updatedAt and updatedBy.
 * Use with UpdateCommand to append audit tracking to any update operation.
 */
export function auditUpdateExpression(userId: string) {
  const now = nowIso();
  return {
    setExpressions: ['#updatedAt = :updatedAt', '#updatedBy = :updatedBy'],
    expressionAttributeNames: {
      '#updatedAt': 'updatedAt',
      '#updatedBy': 'updatedBy',
    },
    expressionAttributeValues: {
      ':updatedAt': now,
      ':updatedBy': userId,
    },
  };
}