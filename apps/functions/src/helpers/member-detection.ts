import type { DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { queryByIndex } from '@/helpers/db';
import { getOrganizationById } from '@/helpers/org';
import { PK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';
import { Sentry } from '@/sentry-lambda';
import { MemberDetectionEventSchema } from '@auto-rfp/core';
import type { MemberDetectionEvent, MemberDetectionEventType } from '@auto-rfp/core';

const GSI_BY_USER_ID = 'byUserId';

/**
 * Count how many org memberships exist for a Cognito sub (userId).
 * The just-inserted record is included, so:
 *   count <= 1  → NEW_ACCOUNT (this is the user's first/only membership)
 *   count  > 1  → ADDED_TO_ORG (the account already belonged elsewhere)
 */
export const classifyMembership = async (
  userId: string,
): Promise<MemberDetectionEventType> => {
  const memberships = await queryByIndex<Record<string, unknown>>(
    GSI_BY_USER_ID,
    'userId',
    userId,
    { name: PK_NAME, value: USER_PK },
  );
  return memberships.length > 1 ? 'ADDED_TO_ORG' : 'NEW_ACCOUNT';
};

/**
 * Emit the detection as a Sentry event. The Sentry project's alert rule
 * routes these to the internal Slack channel (C0A644FMTJ9).
 * level=info so it does not pollute error dashboards; the alert rule keys
 * off the `member_detection` tag / message, not the level.
 */
export const emitDetectionAlert = (evt: MemberDetectionEvent): void => {
  Sentry.withScope((scope) => {
    scope.setLevel('info');
    scope.setTag('alert_type', 'member_detection');
    scope.setTag('detection_event', evt.eventType);
    scope.setTag('org_id', evt.orgId);
    scope.setContext('member', {
      timestamp: evt.timestamp,
      orgName: evt.orgName,
      email: evt.email,
      firstName: evt.firstName ?? '(none)',
      role: evt.role,
      userId: evt.userId,
    });
    const label = evt.eventType === 'NEW_ACCOUNT'
      ? 'New AutoRFP account'
      : 'Account added to organization';
    Sentry.captureMessage(`${label}: ${evt.email} → ${evt.orgName} (${evt.role})`, 'info');
  });
};

/**
 * Public entry point called by the stream handler for INSERT records.
 * Best-effort: never throws, so a detection failure cannot block the batch
 * or interfere with audit archival happening in the same batch.
 *
 * Gated per-org by the manually-set `enableMemberDetection` flag — orgs that
 * have not opted in produce zero alerts.
 */
export const detectNewMember = async (record: DynamoDBRecord): Promise<void> => {
  if (!record.dynamodb?.NewImage) return;

  const item = unmarshall(record.dynamodb.NewImage as Parameters<typeof unmarshall>[0]);
  if (item[PK_NAME] !== USER_PK) return;
  if (typeof item.userId !== 'string' || typeof item.orgId !== 'string') return;

  try {
    const org = await getOrganizationById(item.orgId);
    if (!org?.enableMemberDetection) return; // org has not opted in — skip silently

    const eventType = await classifyMembership(item.userId);

    const { success, data } = MemberDetectionEventSchema.safeParse({
      eventType,
      timestamp: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      orgId: item.orgId,
      orgName: org.name ?? 'Unknown',
      email: item.email,
      firstName: item.firstName,
      role: item.role ?? 'VIEWER',
      userId: item.userId,
    });

    if (!success) {
      console.error('[member-detection] Malformed USER record, skipping alert:', item);
      return;
    }

    emitDetectionAlert(data);
  } catch (err) {
    console.error('[member-detection] Failed to process record:', err, item);
  }
};
