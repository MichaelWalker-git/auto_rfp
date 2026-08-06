/**
 * Audit-log helpers for the AI Compliance Review feature.
 *
 * Compliance is exactly the kind of feature whose actions must be auditable:
 * who ran an AI review, when it completed/failed, and every dismiss/resolve
 * triage decision. This centralizes the (otherwise repetitive) audit-entry
 * construction so the chat handler, the async worker, and the decision handler
 * all emit consistent, non-blocking log entries.
 *
 * Every write is best-effort: a failed audit write is logged and swallowed so it
 * never fails the user-facing request or the worker.
 */
import { v4 as uuidv4 } from 'uuid';

import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import type { AuditAction, AuditResource } from '@auto-rfp/core';

interface ComplianceAuditArgs {
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  orgId: string;
  /** Cognito sub / user id. Defaults to 'system' for the async worker. */
  userId?: string;
  /** Display name. Defaults to 'system'. */
  userName?: string;
  /** Structured detail stored under changes.after. */
  after?: Record<string, unknown>;
  result?: 'success' | 'failure';
  errorMessage?: string;
  /** Request-scoped metadata (absent for the worker → system defaults). */
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write a compliance-review audit entry. Non-blocking: resolves once the write
 * is attempted; errors are logged and swallowed. Callers may `void` this.
 */
export const writeComplianceAuditLog = async (args: ComplianceAuditArgs): Promise<void> => {
  try {
    await writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: args.userId ?? 'system',
        userName: args.userName ?? 'system',
        organizationId: args.orgId,
        action: args.action,
        resource: args.resource,
        resourceId: args.resourceId,
        changes: args.after ? { after: args.after } : undefined,
        ipAddress: args.ipAddress ?? '0.0.0.0',
        userAgent: args.userAgent ?? 'system',
        result: args.result ?? 'success',
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      },
      await getHmacSecret(),
    );
  } catch (err) {
    console.warn('[compliance-review-audit] failed to write audit log (non-blocking):', (err as Error)?.message);
  }
};
