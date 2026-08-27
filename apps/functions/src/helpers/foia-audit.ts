/**
 * Audit-log writer for FOIA transmissions.
 *
 * Exists because the audit trail had a hole exactly where it mattered most. The manual
 * send handler audits through `auditMiddleware`, which reads context off an HTTP event —
 * but the unattended path is a cron-invoked Lambda with no event to attach to, so
 * `dispatchFoiaRequest` emitted nothing at all. A statutory records request could be
 * filed with a government agency, in the customer's name, with `sentBy: 'system'` and no
 * entry in the log an org's auditors actually read.
 *
 * The send was never invisible — `sentAt`, `sesMessageId` and `updatedBy` land on the
 * automation record, and the exact transmitted bytes sit in S3 — so this closes a
 * reporting gap rather than a forensic one. It is still the difference between "we can
 * reconstruct it if someone asks the right question" and "it is in the audit log".
 *
 * Follows the `compliance-review-audit.ts` pattern: the direct `writeAuditLog` +
 * `getHmacSecret` path, which works outside a request context.
 */
import { v4 as uuidv4 } from 'uuid';

import type { AuditAction, AuditResource } from '@auto-rfp/core';

import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

const FOIA_SEND_ACTION: AuditAction = 'FOIA_REQUEST_SENT';
const FOIA_RESOURCE: AuditResource = 'foia_request';

interface FoiaSendAuditArgs {
  orgId: string;
  /** The FOIA request's own id, which is what an auditor would search for. */
  foiaId: string;
  /** `'system'` on the unattended path, a Cognito sub when a human approved it. */
  sentBy: string;
  result: 'success' | 'failure';
  errorMessage?: string;
  /** Stored under `changes.after` — recipient, SES id, attempt counts. */
  detail?: Record<string, unknown>;
}

/**
 * Records that a FOIA request was transmitted, or that transmission failed.
 *
 * Best-effort and never throws. A failed audit write must not strand a send that already
 * reached SES: the automation record is already `SENT`, and turning a delivered filing
 * into an error would be a worse outcome than a missing log line. Failures are logged
 * loudly instead, because a silent gap here is what this helper exists to fix.
 */
export const writeFoiaSendAuditLog = async (args: FoiaSendAuditArgs): Promise<void> => {
  try {
    await writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: args.sentBy,
        // The unattended path has no human, and saying so is the point: this
        // distinguishes a cron-filed request from one a person approved.
        userName: args.sentBy === 'system' ? 'system (unattended)' : args.sentBy,
        organizationId: args.orgId,
        action: FOIA_SEND_ACTION,
        resource: FOIA_RESOURCE,
        resourceId: args.foiaId,
        ...(args.detail ? { changes: { after: args.detail } } : {}),
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: args.result,
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      },
      await getHmacSecret(),
    );
  } catch (err) {
    console.error(
      `[foia-audit] FAILED to write the audit entry for FOIA ${args.foiaId} (send itself was ${args.result}):`,
      (err as Error)?.message,
    );
  }
};
