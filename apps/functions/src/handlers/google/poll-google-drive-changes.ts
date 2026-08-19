/**
 * poll-google-drive-changes.ts
 *
 * The scheduled half of the bidirectional Drive link: every 15 minutes, for every
 * org with Drive credentials, import any linked document whose Google Doc has moved
 * since the watermark AutoRFP recorded. The manual "Sync now" button runs the same
 * `pullDocumentFromDriveIfChanged` against one document; this only supplies the fan-out.
 *
 * Three properties this handler must keep:
 *  - **It never throws.** EventBridge retries a failed invocation, which would re-run
 *    a whole pass; a failing org or document is counted and stepped over instead.
 *  - **It never overrides an approval.** `acceptApprovedOverride` is a decision only a
 *    named user can make, so the poller leaves approved documents `BLOCKED_APPROVED`
 *    and lets the notification tell someone.
 *  - **It bypasses RBAC by construction.** There is no request and no caller, so the
 *    org's own Drive service-account credential is the authorization boundary: no
 *    credential in Secrets Manager means the org is skipped before it is even queried.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';

import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import { queryByIndex } from '@/helpers/db';
import { listAllOrgIds } from '@/helpers/org';
import { getHmacSecret } from '@/helpers/secret';
import { writeAuditLog } from '@/helpers/audit-log';
import { getDriveClientForOrg } from '@/helpers/google-drive-client';
import {
  DRIVE_SYNC_INDEX_NAME,
  DRIVE_SYNC_PK_ATTRIBUTE,
  type DriveSyncDocument,
  markDriveSyncFailed,
  pullDocumentFromDriveIfChanged,
} from '@/helpers/google-drive-document-sync';

/** Documents imported concurrently within a single org. */
const DOCUMENT_CONCURRENCY = 3;

type PollEvent = EventBridgeEvent<
  'gdrive.pollChanges',
  { dryRun?: boolean; orgId?: string; documentId?: string } | undefined
>;

interface OrgOutcome {
  orgId: string;
  /** Absent when the org has no Drive credential — it was never queried. */
  linked?: number;
  imported?: number;
  blocked?: number;
  unchanged?: number;
  failed?: number;
  skipped?: boolean;
  error?: string;
}

/** Run `worker` over `items` with at most `limit` in flight. */
const withConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
};

/**
 * Poll one org. Resolves to an outcome even when the org fails outright — a broken
 * credential or an index read error must not stop the orgs that follow.
 */
const pollOrg = async (args: {
  orgId: string;
  documentId?: string;
  dryRun: boolean;
}): Promise<OrgOutcome> => {
  const { orgId, documentId, dryRun } = args;

  try {
    // Checked before the index read: an org that never configured Drive should cost
    // one Secrets Manager miss, not a GSI query.
    const client = await getDriveClientForOrg(orgId);
    if (!client) {
      return { orgId, skipped: true };
    }

    const allLinks = await queryByIndex<DriveSyncDocument>(
      DRIVE_SYNC_INDEX_NAME,
      DRIVE_SYNC_PK_ATTRIBUTE,
      orgId,
    );

    // The GSI is sparse (keys written only while linked), but a soft-deleted document
    // keeps its keys until something updates it, so filter here too.
    const links = allLinks.filter(
      (link) =>
        !link.deletedAt &&
        link.googleDriveFileId &&
        (!documentId || link.documentId === documentId),
    );

    if (dryRun) {
      console.log(`[GoogleDrive] Dry run: ${orgId} has ${links.length} linked document(s)`);
      return { orgId, linked: links.length, imported: 0, blocked: 0, unchanged: 0, failed: 0 };
    }

    let imported = 0;
    let blocked = 0;
    let unchanged = 0;
    let failed = 0;

    await withConcurrency(links, DOCUMENT_CONCURRENCY, async (link) => {
      const { projectId, opportunityId, documentId: linkDocumentId } = link;
      if (!projectId || !opportunityId || !linkDocumentId) {
        console.warn(`[GoogleDrive] Skipping malformed link on ${link.sort_key ?? 'unknown'}`);
        failed += 1;
        return;
      }

      try {
        const result = await pullDocumentFromDriveIfChanged({
          drive: client.drive,
          doc: link,
          orgId,
          projectId,
          opportunityId,
          documentId: linkDocumentId,
          // No actor: the helper stamps the system identity. And never an override —
          // reopening an approval is a user's call, not a schedule's.
        });

        if (result.blocked) blocked += 1;
        else if (result.changed) imported += 1;
        else unchanged += 1;
      } catch (err) {
        failed += 1;
        const message = (err as Error)?.message ?? 'Unknown error';
        console.error(`[GoogleDrive] Import failed for ${linkDocumentId}: ${message}`);
        // The helper already recorded this on the way out; repeat it defensively so a
        // failure before its own catch still leaves a visible badge.
        await markDriveSyncFailed({
          projectId,
          opportunityId,
          documentId: linkDocumentId,
          message,
        }).catch((markErr) => {
          console.error('[GoogleDrive] Failed to record sync failure:', markErr);
        });
      }
    });

    return { orgId, linked: links.length, imported, blocked, unchanged, failed };
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unknown error';
    console.error(`[GoogleDrive] Poll failed for org ${orgId}: ${message}`);
    return { orgId, error: message };
  }
};

/** Best-effort run summary in the audit trail; a failed write must not fail the pass. */
const auditPass = async (args: {
  orgId: string;
  result: 'success' | 'failure';
  errorMessage?: string;
  changes: Record<string, unknown>;
}): Promise<void> => {
  try {
    await writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: 'system',
        userName: 'Google Drive sync',
        organizationId: args.orgId,
        action: args.result === 'success' ? 'INTEGRATION_SYNC_COMPLETED' : 'INTEGRATION_SYNC_FAILED',
        resource: 'rfp_document',
        resourceId: 'google-drive-poll',
        changes: { after: args.changes },
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: args.result,
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      },
      await getHmacSecret(),
    );
  } catch (err) {
    console.warn('[GoogleDrive] Audit write failed (non-blocking):', err);
  }
};

export const baseHandler = async (event: PollEvent) => {
  const dryRun = event.detail?.dryRun === true;
  const onlyOrgId = event.detail?.orgId;
  const onlyDocumentId = event.detail?.documentId;
  const ranAt = nowIso();

  let orgIds: string[];
  try {
    orgIds = onlyOrgId ? [onlyOrgId] : await listAllOrgIds();
  } catch (err) {
    // Nothing can be done this pass, but throwing would earn an EventBridge retry.
    console.error('[GoogleDrive] Failed to list organizations:', err);
    return { ok: false, dryRun, ranAt, orgCount: 0, error: (err as Error)?.message };
  }

  console.log(
    `[GoogleDrive] Polling ${orgIds.length} org(s)${dryRun ? ' (dry run)' : ''}` +
      `${onlyDocumentId ? ` for document ${onlyDocumentId}` : ''}`,
  );

  const outcomes: OrgOutcome[] = [];
  // Sequential across orgs: each org holds its own Drive quota, and a serial pass
  // keeps a large tenant from starving the others inside one 5-minute invocation.
  for (const orgId of orgIds) {
    const outcome = await pollOrg({ orgId, documentId: onlyDocumentId, dryRun });
    outcomes.push(outcome);

    if (outcome.skipped || dryRun) continue;

    if (outcome.error) {
      await auditPass({
        orgId,
        result: 'failure',
        errorMessage: outcome.error,
        changes: { ranAt },
      });
    } else if ((outcome.imported ?? 0) > 0 || (outcome.blocked ?? 0) > 0 || (outcome.failed ?? 0) > 0) {
      // Only log passes that did something; a quiet org every 15 minutes would bury
      // the audit trail in noise (entries carry a 90-day TTL either way).
      await auditPass({
        orgId,
        result: (outcome.failed ?? 0) > 0 ? 'failure' : 'success',
        changes: {
          ranAt,
          linked: outcome.linked,
          imported: outcome.imported,
          blocked: outcome.blocked,
          failed: outcome.failed,
        },
      });
    }
  }

  const totals = outcomes.reduce(
    (acc, outcome) => ({
      linked: acc.linked + (outcome.linked ?? 0),
      imported: acc.imported + (outcome.imported ?? 0),
      blocked: acc.blocked + (outcome.blocked ?? 0),
      unchanged: acc.unchanged + (outcome.unchanged ?? 0),
      failed: acc.failed + (outcome.failed ?? 0),
      skipped: acc.skipped + (outcome.skipped ? 1 : 0),
      errored: acc.errored + (outcome.error ? 1 : 0),
    }),
    { linked: 0, imported: 0, blocked: 0, unchanged: 0, failed: 0, skipped: 0, errored: 0 },
  );

  console.log(`[GoogleDrive] Poll complete: ${JSON.stringify(totals)}`);

  return {
    ok: true,
    dryRun,
    ranAt,
    orgCount: orgIds.length,
    totals,
    // Only orgs that did something, so a 200-org account doesn't return 200 empty rows.
    outcomes: outcomes.filter(
      (outcome) => outcome.error || (outcome.linked ?? 0) > 0,
    ),
  };
};

export const handler = withSentryLambda(middy(baseHandler));
