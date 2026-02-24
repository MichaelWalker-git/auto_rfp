import type { MiddlewareObj } from '@middy/core';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { AuditAction, AuditLogPayload, AuditResource } from '@auto-rfp/core';
import { nowIso } from '@/helpers/date';

const sqs = new SQSClient({});
const AUDIT_QUEUE_URL = process.env['AUDIT_LOG_QUEUE_URL'] ?? '';

export interface AuditContext {
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  /** Explicit orgId — use when orgId comes from the request body rather than query params */
  orgId?: string;
  changes?: { before?: unknown; after?: unknown };
}

/**
 * Attach audit context to the event so the middleware can pick it up.
 * Call this inside your handler before returning:
 *   setAuditContext(event, { action: 'PROJECT_CREATED', resource: 'project', resourceId: project.id, orgId: data.orgId });
 */
export const setAuditContext = (event: AuthedEvent, ctx: AuditContext): void => {
  (event as AuthedEvent & { _auditCtx?: AuditContext })._auditCtx = ctx;
};

/**
 * Resolve a human-readable display name from Cognito JWT claims.
 * Priority: full name > given+family > email > userId (sub)
 */
const resolveUserName = (event: AuthedEvent): string => {
  const claims = event.auth?.claims ?? {};
  const userId = event.auth?.userId ?? 'anonymous';

  const firstName = typeof claims['given_name'] === 'string' ? claims['given_name'].trim() : '';
  const lastName = typeof claims['family_name'] === 'string' ? claims['family_name'].trim() : '';
  const fullName = typeof claims['name'] === 'string' ? claims['name'].trim() : '';
  const email = typeof claims['email'] === 'string' ? claims['email'].trim() : '';

  if (fullName) return fullName;
  if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(' ');
  if (email) return email;
  return userId;
};

/**
 * Resolve orgId — checks (in order):
 * 1. Explicit orgId set via setAuditContext
 * 2. event.auth?.orgId (from x-org-id header or query param via authContextMiddleware)
 * 3. event.queryStringParameters?.orgId
 * 4. Request body orgId (parsed from JSON body)
 * 5. 'global' fallback
 */
const resolveOrgId = (event: AuthedEvent, auditCtx?: AuditContext): string => {
  if (auditCtx?.orgId) return auditCtx.orgId;
  if (event.auth?.orgId) return event.auth.orgId;
  if (event.queryStringParameters?.orgId) return event.queryStringParameters.orgId;

  // Try to extract orgId from request body
  if (event.body) {
    try {
      const body = JSON.parse(event.body) as Record<string, unknown>;
      if (typeof body.orgId === 'string' && body.orgId) return body.orgId;
      if (typeof body.organizationId === 'string' && body.organizationId) return body.organizationId;
    } catch {
      // ignore parse errors
    }
  }

  return 'global';
};

export const auditMiddleware = (): MiddlewareObj<AuthedEvent, APIGatewayProxyResultV2> => ({
  after: async (request) => {
    if (!AUDIT_QUEUE_URL) return; // skip if queue not configured (local dev)

    try {
      const event = request.event;
      const response = request.response as APIGatewayProxyResultV2 | undefined;
      const auditCtx = (event as AuthedEvent & { _auditCtx?: AuditContext })._auditCtx;

      if (!auditCtx) return; // handler did not set audit context — skip

      const statusCode = typeof response === 'object' && response !== null && 'statusCode' in response
        ? (response as { statusCode: number }).statusCode
        : 200;

      const userId = event.auth?.userId ?? 'anonymous';
      const userName = resolveUserName(event);
      const orgId = resolveOrgId(event, auditCtx);

      const payload: AuditLogPayload = {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId,
        userName,
        organizationId: orgId,
        action: auditCtx.action,
        resource: auditCtx.resource,
        resourceId: auditCtx.resourceId,
        changes: auditCtx.changes,
        ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent: event.requestContext?.http?.userAgent ?? 'unknown',
        result: statusCode >= 400 ? 'failure' : 'success',
        errorMessage: statusCode >= 400
          ? (() => { try { return JSON.parse((response as { body: string }).body)?.message; } catch { return undefined; } })()
          : undefined,
      };

      // Fire-and-forget — never await, never throw
      sqs.send(new SendMessageCommand({
        QueueUrl: AUDIT_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      })).catch((err) => {
        console.error('[audit-middleware] Failed to enqueue audit log:', err);
      });
    } catch (err) {
      // Audit failures must never break user requests
      console.error('[audit-middleware] Unexpected error:', err);
    }
  },

  onError: async (request) => {
    if (!AUDIT_QUEUE_URL) return;

    try {
      const event = request.event;
      const auditCtx = (event as AuthedEvent & { _auditCtx?: AuditContext })._auditCtx;
      if (!auditCtx) return;

      const userId = event.auth?.userId ?? 'anonymous';
      const userName = resolveUserName(event);
      const orgId = resolveOrgId(event, auditCtx);

      const payload: AuditLogPayload = {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId,
        userName,
        organizationId: orgId,
        action: auditCtx.action,
        resource: auditCtx.resource,
        resourceId: auditCtx.resourceId,
        ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent: event.requestContext?.http?.userAgent ?? 'unknown',
        result: 'failure',
        errorMessage: request.error instanceof Error ? request.error.message : 'Unknown error',
      };

      sqs.send(new SendMessageCommand({
        QueueUrl: AUDIT_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      })).catch(() => { /* silent */ });
    } catch {
      // never throw from audit middleware
    }
  },
});
