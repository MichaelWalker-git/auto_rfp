import { UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  FoiaAutomationItem,
  FoiaAutomationDBItem,
  FoiaAutomationCreateRequest,
  FoiaAutomationState,
} from '@auto-rfp/core';
import { getItem, putItem, queryAllBySkPrefix, docClient, withRetry } from '@/helpers/db';
import { FOIA_AUTOMATION_PK } from '@/constants/foia';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { nowIso } from '@/helpers/date';
import { requireEnv } from '@/helpers/env';
import { updateOpportunity } from '@/helpers/opportunity';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Build SK for a FOIA automation record.
 * SK pattern: `${orgId}#${projectId}#${oppId}`
 */
export const buildFoiaAutomationSk = (orgId: string, projectId: string, oppId: string): string =>
  `${orgId}#${projectId}#${oppId}`;

/**
 * Fetch a FOIA automation record by exact identifiers.
 */
export const getFoiaAutomation = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<FoiaAutomationDBItem | null> =>
  getItem<FoiaAutomationDBItem>(FOIA_AUTOMATION_PK, buildFoiaAutomationSk(orgId, projectId, oppId));

/**
 * Create or update a FOIA automation record (upsert-style, no conditional check).
 *
 * Preserves `createdAt` and `attemptCount`: the reconciling scanner re-seeds
 * records on every pass, so resetting the attempt counter here would let a
 * permanently-failing send retry forever and defeat FOIA_MAX_SEND_ATTEMPTS.
 * Existing progress fields are preserved too — the dto only overrides what it
 * explicitly carries.
 */
export const upsertFoiaAutomation = async (
  dto: FoiaAutomationCreateRequest,
): Promise<FoiaAutomationItem> => {
  const now = nowIso();
  const existing = await getFoiaAutomation(dto.orgId, dto.projectId, dto.oppId);
  const createdAt = existing?.createdAt ?? now;

  return putItem<FoiaAutomationItem>(
    FOIA_AUTOMATION_PK,
    buildFoiaAutomationSk(dto.orgId, dto.projectId, dto.oppId),
    {
      ...existing,
      ...dto,
      attemptCount: existing?.attemptCount ?? 0,
      createdAt,
    },
    false,
  );
};

/**
 * List all FOIA automations across all orgs (paginated Query on PK alone).
 * Valid because FOIA_AUTOMATION_PK is a literal constant — every automation
 * shares the same PK, so a begins_with-free Query returns the full set.
 * Used by the scanner to find all due automations.
 */
export const listFoiaAutomationsForScan = async (): Promise<FoiaAutomationDBItem[]> => {
  const items: FoiaAutomationDBItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await withRetry(
      () =>
        docClient.send(
          new QueryCommand({
            TableName: DB_TABLE_NAME,
            KeyConditionExpression: '#pk = :pk',
            ExpressionAttributeNames: { '#pk': PK_NAME },
            ExpressionAttributeValues: { ':pk': FOIA_AUTOMATION_PK },
            ExclusiveStartKey,
          }),
        ),
      { label: 'listFoiaAutomationsForScan' },
    );

    items.push(...((res.Items as FoiaAutomationDBItem[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return items;
};

/**
 * List all FOIA automations for an organization (paginated).
 */
export const listFoiaAutomationsByOrg = async (orgId: string): Promise<FoiaAutomationDBItem[]> => {
  const skPrefix = `${orgId}#`;
  return queryAllBySkPrefix<FoiaAutomationDBItem>(FOIA_AUTOMATION_PK, skPrefix);
};

/**
 * Conditionally transition a FOIA automation from one state (or array of states)
 * to a new state with an optional patch.
 *
 * This is the double-send guard: the ConditionExpression ensures the current
 * state is one of the allowed `from` states before applying the transition.
 * If the condition fails (someone else already moved it), returns null instead
 * of throwing — the caller treats this as a no-op.
 *
 * @param from - Single state or array of valid source states
 * @param to - Target state
 * @param patch - Optional partial fields to update alongside the state
 * @returns The updated item, or null if the condition failed
 */
export const transitionFoiaAutomationState = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  from: FoiaAutomationState | FoiaAutomationState[];
  to: FoiaAutomationState;
  patch?: Partial<FoiaAutomationItem>;
  updatedBy?: string;
}): Promise<FoiaAutomationDBItem | null> => {
  const { orgId, projectId, oppId, from, to, patch, updatedBy } = args;
  const now = nowIso();

  const fromStates = Array.isArray(from) ? from : [from];
  const names: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
    '#state': 'state',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
    ':to': to,
    ':updatedAt': now,
  };

  // Build condition: #state IN (:from0, :from1, ...)
  fromStates.forEach((state, idx) => {
    values[`:from${idx}`] = state;
  });
  const fromPlaceholders = fromStates.map((_, idx) => `:from${idx}`).join(', ');
  const conditionExpression = `attribute_exists(#pk) AND attribute_exists(#sk) AND #state IN (${fromPlaceholders})`;

  // Build SET expression
  const updates: string[] = ['#state = :to', '#updatedAt = :updatedAt'];
  if (updatedBy) {
    names['#updatedBy'] = 'updatedBy';
    values[':updatedBy'] = updatedBy;
    updates.push('#updatedBy = :updatedBy');
  }

  if (patch) {
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined && key !== 'state' && key !== 'updatedAt' && key !== 'updatedBy') {
        const nameKey = `#p_${key}`;
        const valueKey = `:p_${key}`;
        names[nameKey] = key;
        values[valueKey] = value;
        updates.push(`${nameKey} = ${valueKey}`);
      }
    });
  }

  try {
    const res = await withRetry(
      () =>
        docClient.send(
          new UpdateCommand({
            TableName: DB_TABLE_NAME,
            Key: {
              [PK_NAME]: FOIA_AUTOMATION_PK,
              [SK_NAME]: buildFoiaAutomationSk(orgId, projectId, oppId),
            },
            UpdateExpression: `SET ${updates.join(', ')}`,
            ConditionExpression: conditionExpression,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW',
          }),
        ),
      { label: 'transitionFoiaAutomationState' },
    );

    return (res.Attributes as FoiaAutomationDBItem) ?? null;
  } catch (err) {
    // ConditionalCheckFailedException means someone else already transitioned it
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return null;
    }
    throw err;
  }
};

/**
 * Unconditionally set the FOIA automation state (thin upsert-style setter).
 * Used for initial seeding or cases where there is no meaningful prior state
 * to guard against. Keep this distinct from the conditional transition.
 */
export const setFoiaAutomationState = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  state: FoiaAutomationState;
  patch?: Partial<FoiaAutomationItem>;
}): Promise<FoiaAutomationItem> => {
  const { orgId, projectId, oppId, state, patch } = args;
  const now = nowIso();
  const existing = await getFoiaAutomation(orgId, projectId, oppId);

  return putItem<FoiaAutomationItem>(
    FOIA_AUTOMATION_PK,
    buildFoiaAutomationSk(orgId, projectId, oppId),
    {
      ...existing,
      ...patch,
      orgId,
      projectId,
      oppId,
      state,
      attemptCount: existing?.attemptCount ?? 0,
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    },
    false,
  );
};

/**
 * Best-effort sync of the automation state back to the opportunity record.
 * The scanner re-syncs on every pass, so a failure here only logs — it must
 * never break a state transition.
 */
export const syncOpportunityFoiaMarker = async (
  orgId: string,
  projectId: string,
  oppId: string,
  state: FoiaAutomationState,
): Promise<void> => {
  try {
    await updateOpportunity({
      orgId,
      projectId,
      oppId,
      patch: { foiaAutomationState: state },
    });
  } catch (err) {
    console.warn(
      `[foia-automation] failed to sync foiaAutomationState to opportunity ${oppId}:`,
      err,
    );
  }
};

/**
 * Count FOIA requests sent today by this organization (for the dailySendCap guard).
 *
 * The day boundary is derived from the ISO date prefix rather than from Date
 * arithmetic: every `sentAt` is stored as a UTC ISO string, so comparing the
 * leading `YYYY-MM-DD` is exact and cannot drift with the Lambda's local
 * timezone the way `setUTCHours` on a locally-constructed Date does.
 *
 * @param now - injectable for tests; defaults to the current time.
 */
export const countFoiaSentToday = async (orgId: string, now: Date = new Date()): Promise<number> => {
  const items = await listFoiaAutomationsByOrg(orgId);
  const today = now.toISOString().slice(0, 10);

  return items.filter((item) => {
    if (!item.sentAt) return false;
    return new Date(item.sentAt).toISOString().slice(0, 10) === today;
  }).length;
};
