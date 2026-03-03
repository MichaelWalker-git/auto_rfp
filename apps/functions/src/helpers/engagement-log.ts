import { GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { createItem, DBItem, docClient } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ENGAGEMENT_LOG_PK } from '../constants/engagement-log';
import { safeSplit } from './safe-string';
import { nowIso } from './date';

import type {
  EngagementLogItem,
  CreateEngagementLogDTO,
  UpdateEngagementLogDTO,
  EngagementMetrics,
} from '@auto-rfp/core';

const DOCUMENTS_TABLE = requireEnv('DB_TABLE_NAME');

export type EngagementLogDBItem = EngagementLogItem & DBItem;

/**
 * Build sort key for engagement log
 * Format: `${orgId}#${projectId}#${opportunityId}#${engagementId}`
 */
export const buildEngagementLogSk = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  engagementId: string
) => `${orgId}#${projectId}#${opportunityId}#${engagementId}`;

/**
 * Build sort key prefix for querying by opportunity
 */
export const buildEngagementLogSkPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string
) => `${orgId}#${projectId}#${opportunityId}#`;

/**
 * Parse sort key to extract IDs
 */
export const parseEngagementLogSk = (sk: string) => {
  const parts = safeSplit(sk, '#');
  return {
    orgId: parts[0] ?? '',
    projectId: parts[1] ?? '',
    opportunityId: parts[2] ?? '',
    engagementId: parts[3] ?? '',
  };
};

/**
 * CREATE an engagement log entry
 */
export const createEngagementLog = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  engagement: Omit<CreateEngagementLogDTO, 'orgId' | 'projectId' | 'opportunityId'>;
}) => {
  const engagementId = uuidv4();

  const item = await createItem<EngagementLogDBItem>(
    ENGAGEMENT_LOG_PK,
    buildEngagementLogSk(args.orgId, args.projectId, args.opportunityId, engagementId),
    {
      ...args.engagement,
      engagementId,
      orgId: args.orgId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
    } as EngagementLogDBItem
  );

  return { item, engagementId };
};

/**
 * READ (by engagementId)
 */
export const getEngagementLog = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  engagementId: string;
}) => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: ENGAGEMENT_LOG_PK,
        [SK_NAME]: buildEngagementLogSk(
          args.orgId,
          args.projectId,
          args.opportunityId,
          args.engagementId
        ),
      },
    })
  );

  const item = (res.Item as EngagementLogDBItem | undefined) ?? undefined;
  return item ? { item, engagementId: args.engagementId } : undefined;
};

/**
 * LIST (by opportunity)
 */
export const listEngagementLogsByOpportunity = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  limit?: number;
  nextToken?: Record<string, unknown>;
}) => {
  const skPrefix = buildEngagementLogSkPrefix(args.orgId, args.projectId, args.opportunityId);

  const res = await docClient.send(
    new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      KeyConditionExpression: `#pk = :pk AND begins_with(#sk, :skPrefix)`,
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': ENGAGEMENT_LOG_PK,
        ':skPrefix': skPrefix,
      },
      Limit: args.limit,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false, // Most recent first
    })
  );

  const items = (res.Items as EngagementLogDBItem[]) ?? [];

  // Sort by interactionDate descending (most recent first)
  // DynamoDB SK-based sorting doesn't work for chronological order since SK ends with UUID
  items.sort((a, b) => {
    const dateA = new Date(a.interactionDate).getTime();
    const dateB = new Date(b.interactionDate).getTime();
    return dateB - dateA; // Descending (most recent first)
  });

  return {
    items,
    nextToken: res.LastEvaluatedKey ?? null,
  };
};

/**
 * UPDATE (partial)
 */
export const updateEngagementLog = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  engagementId: string;
  patch: UpdateEngagementLogDTO;
}) => {
  const forbidden = new Set<string>([
    PK_NAME, SK_NAME, 'createdAt', 'updatedAt', 'engagementId',
    'orgId', 'projectId', 'opportunityId', 'interactionType', 'interactionDate', 'direction'
  ]);
  const patchEntries = Object.entries(args.patch).filter(
    ([k, v]) => !forbidden.has(k) && typeof v !== 'undefined'
  );

  const names: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
    ':u': nowIso(),
  };

  const updates: string[] = [];

  for (const [k, v] of patchEntries) {
    const nameKey = `#f_${k}`;
    const valueKey = `:v_${k}`;

    names[nameKey] = k;
    values[valueKey] = v;

    updates.push(`${nameKey} = ${valueKey}`);
  }

  updates.push('#updatedAt = :u');

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: ENGAGEMENT_LOG_PK,
        [SK_NAME]: buildEngagementLogSk(
          args.orgId,
          args.projectId,
          args.opportunityId,
          args.engagementId
        ),
      },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: `attribute_exists(#pk) AND attribute_exists(#sk)`,
      ReturnValues: 'ALL_NEW',
    })
  );

  return { item: res.Attributes as EngagementLogDBItem, engagementId: args.engagementId };
};

/**
 * DELETE
 */
export const deleteEngagementLog = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  engagementId: string;
}) => {
  await docClient.send(
    new DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: ENGAGEMENT_LOG_PK,
        [SK_NAME]: buildEngagementLogSk(
          args.orgId,
          args.projectId,
          args.opportunityId,
          args.engagementId
        ),
      },
      ConditionExpression: `attribute_exists(#pk) AND attribute_exists(#sk)`,
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
    })
  );

  return { ok: true as const };
};

/**
 * Calculate engagement metrics for an opportunity
 */
export const calculateEngagementMetrics = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
}): Promise<EngagementMetrics> => {
  const { items } = await listEngagementLogsByOpportunity({
    orgId: args.orgId,
    projectId: args.projectId,
    opportunityId: args.opportunityId,
    limit: 1000,
  });

  const metrics: EngagementMetrics = {
    totalInteractions: items.length,
    questionsSubmitted: 0,
    responsesReceived: 0,
    responseRate: 0,
    phoneCalls: 0,
    meetings: 0,
    siteVisits: 0,
    lastInteractionDate: null,
    averageResponseTimeDays: null,
  };

  let latestDate: Date | null = null;
  
  // Track outbound and inbound interactions for response time calculation
  const outboundInteractions: Array<{ date: Date; type: string }> = [];
  const inboundInteractions: Array<{ date: Date; type: string }> = [];

  for (const item of items) {
    const interactionDate = new Date(item.interactionDate);

    // Track latest interaction
    if (!latestDate || interactionDate > latestDate) {
      latestDate = interactionDate;
    }

    // Track direction for response time
    if (item.direction === 'OUTBOUND') {
      outboundInteractions.push({ date: interactionDate, type: item.interactionType });
    } else if (item.direction === 'INBOUND') {
      inboundInteractions.push({ date: interactionDate, type: item.interactionType });
    }

    // Count by type
    switch (item.interactionType) {
      case 'QUESTION_SUBMITTED':
        metrics.questionsSubmitted++;
        break;
      case 'RESPONSE_RECEIVED':
        metrics.responsesReceived++;
        break;
      case 'PHONE_CALL':
        metrics.phoneCalls++;
        break;
      case 'MEETING':
        metrics.meetings++;
        break;
      case 'SITE_VISIT':
        metrics.siteVisits++;
        break;
    }
  }

  // Set last interaction date
  if (latestDate) {
    metrics.lastInteractionDate = latestDate.toISOString();
  }

  // Calculate response rate (as a ratio 0-1 for frontend to display as percentage)
  // Based on outbound vs inbound interactions
  const outboundCount = outboundInteractions.length;
  const inboundCount = inboundInteractions.length;
  
  if (outboundCount > 0) {
    metrics.responseRate = Math.min(1, Math.round((inboundCount / outboundCount) * 100) / 100);
  }

  // Calculate average response time
  // Match each inbound interaction with the most recent preceding outbound interaction
  if (inboundInteractions.length > 0 && outboundInteractions.length > 0) {
    // Sort both arrays chronologically (ascending)
    outboundInteractions.sort((a, b) => a.date.getTime() - b.date.getTime());
    inboundInteractions.sort((a, b) => a.date.getTime() - b.date.getTime());

    let totalDays = 0;
    let validResponses = 0;

    for (const inbound of inboundInteractions) {
      // Find the most recent outbound before this inbound
      let latestOutbound: Date | null = null;
      for (const outbound of outboundInteractions) {
        if (outbound.date.getTime() < inbound.date.getTime()) {
          latestOutbound = outbound.date;
        } else {
          break; // Outbound is after inbound, stop
        }
      }

      if (latestOutbound) {
        const diffMs = inbound.date.getTime() - latestOutbound.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays >= 0) {
          totalDays += diffDays;
          validResponses++;
        }
      }
    }

    if (validResponses > 0) {
      metrics.averageResponseTimeDays = Math.round((totalDays / validResponses) * 10) / 10;
    }
  }

  return metrics;
};
