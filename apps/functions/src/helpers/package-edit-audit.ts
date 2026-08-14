/**
 * Audit-log helpers for Cross-Package AI Editing.
 *
 * Every applied edit mutates package content (documents + forms), so the apply
 * loop must record who changed what (before→after) — the compliance-tool audit
 * gap taught us to log mutations. Run start/finish are logged too. Centralizes
 * the entry construction so the chat handler, worker, and apply handler stay
 * consistent. Every write is best-effort (logged + swallowed, never blocking).
 */
import { v4 as uuidv4 } from 'uuid';

import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import type { AuditAction, AuditResource } from '@auto-rfp/core';

interface PackageEditAuditArgs {
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  orgId: string;
  userId?: string;
  userName?: string;
  after?: Record<string, unknown>;
  result?: 'success' | 'failure';
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
}

export const writePackageEditAuditLog = async (args: PackageEditAuditArgs): Promise<void> => {
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
    console.warn('[package-edit-audit] failed to write audit log (non-blocking):', (err as Error)?.message);
  }
};
