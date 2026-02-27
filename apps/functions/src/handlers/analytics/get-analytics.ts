import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { PROJECT_OUTCOME_PK, PROJECT_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import {
  calculateWinRate,
  calculateSubmissionRate,
  getMonthsInRange,
  createEmptyMonthlyAnalytics,
  formatMonth,
} from '@auto-rfp/core';
import type { DBProjectOutcome } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * GET /analytics/get-analytics?orgId=X&startMonth=YYYY-MM&endMonth=YYYY-MM
 *
 * Computes monthly analytics for an organisation by aggregating project outcomes.
 * Returns per-month breakdowns and a summary for the requested period.
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { orgId, startMonth, endMonth } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!startMonth) return apiResponse(400, { message: 'startMonth is required (YYYY-MM)' });
  if (!endMonth) return apiResponse(400, { message: 'endMonth is required (YYYY-MM)' });

  const monthRegex = /^\d{4}-\d{2}$/;
  if (!monthRegex.test(startMonth) || !monthRegex.test(endMonth)) {
    return apiResponse(400, { message: 'startMonth and endMonth must be in YYYY-MM format' });
  }
  if (startMonth > endMonth) {
    return apiResponse(400, { message: 'startMonth must be before or equal to endMonth' });
  }

  // ── 1. Fetch all project outcomes for the org ──────────────────────────────
  const outcomes = await fetchOrgOutcomes(orgId);

  // ── 2. Fetch all projects for the org (to get submission dates) ────────────
  const projects = await fetchOrgProjects(orgId);

  // Build a map: projectId → project
  const projectMap = new Map<string, { createdAt: string; submittedAt?: string }>();
  for (const p of projects) {
    projectMap.set(p.projectId, { createdAt: p.createdAt, submittedAt: p.submittedAt });
  }

  // ── 3. Aggregate per month ─────────────────────────────────────────────────
  const months = getMonthsInRange(startMonth, endMonth);
  const monthlyMap = new Map<string, ReturnType<typeof createEmptyMonthlyAnalytics>>();

  for (const month of months) {
    monthlyMap.set(month, createEmptyMonthlyAnalytics(orgId, month));
  }

  // Track which projectIds appear in each month (for totalProjects count)
  const projectsByMonth = new Map<string, Set<string>>();
  for (const month of months) {
    projectsByMonth.set(month, new Set());
  }

  // Track submitted projects per month
  const submittedByMonth = new Map<string, Set<string>>();
  for (const month of months) {
    submittedByMonth.set(month, new Set());
  }

  for (const outcome of outcomes) {
    const statusDate = outcome.statusDate ?? outcome.updatedAt ?? outcome.createdAt;
    if (!statusDate) continue;

    const month = formatMonth(new Date(statusDate));
    if (!monthlyMap.has(month)) continue;

    const entry = monthlyMap.get(month)!;
    const projectSet = projectsByMonth.get(month)!;
    const submittedSet = submittedByMonth.get(month)!;

    projectSet.add(outcome.projectId);

    // Count as submitted if status is not PENDING
    if (outcome.status !== 'PENDING') {
      submittedSet.add(outcome.projectId);
      entry.projectsSubmitted++;
    }

    switch (outcome.status) {
      case 'WON':
        entry.projectsWon++;
        if (outcome.winData?.contractValue) {
          entry.totalWonValue += outcome.winData.contractValue;
          entry.totalPipelineValue += outcome.winData.contractValue;
        }
        break;
      case 'LOST':
        entry.projectsLost++;
        if (outcome.lossData?.ourBidAmount) {
          entry.totalLostValue += outcome.lossData.ourBidAmount;
          entry.totalPipelineValue += outcome.lossData.ourBidAmount;
        }
        if (outcome.lossData?.lossReason) {
          const reason = outcome.lossData.lossReason;
          entry.lossReasonCounts[reason] = (entry.lossReasonCounts[reason] ?? 0) + 1;
        }
        break;
      case 'NO_BID':
        entry.projectsNoBid++;
        break;
      case 'WITHDRAWN':
        entry.projectsWithdrawn++;
        break;
      case 'PENDING':
        entry.projectsPending++;
        break;
    }

    // Time to decision (from project creation to status date)
    const proj = projectMap.get(outcome.projectId);
    if (proj?.createdAt && statusDate && outcome.status !== 'PENDING') {
      const createdMs = new Date(proj.createdAt).getTime();
      const decidedMs = new Date(statusDate).getTime();
      const days = (decidedMs - createdMs) / (1000 * 60 * 60 * 24);
      if (days >= 0) {
        // Accumulate for averaging later
        (entry as any)._timeToDecisionSum = ((entry as any)._timeToDecisionSum ?? 0) + days;
        (entry as any)._timeToDecisionCount = ((entry as any)._timeToDecisionCount ?? 0) + 1;
      }
    }
  }

  // Finalise per-month metrics
  const analyticsArray = months.map((month) => {
    const entry = monthlyMap.get(month)!;
    const projectSet = projectsByMonth.get(month)!;

    entry.totalProjects = projectSet.size;

    // Average contract value
    const decidedCount = entry.projectsWon + entry.projectsLost;
    if (decidedCount > 0) {
      entry.averageContractValue = (entry.totalWonValue + entry.totalLostValue) / decidedCount;
    }

    // Win rate
    entry.winRate = calculateWinRate(entry.projectsWon, entry.projectsLost);

    // Submission rate
    entry.submissionRate = calculateSubmissionRate(entry.projectsSubmitted, entry.totalProjects);

    // Average time to decision
    const ttdCount = (entry as any)._timeToDecisionCount ?? 0;
    const ttdSum = (entry as any)._timeToDecisionSum ?? 0;
    entry.averageTimeToDecision = ttdCount > 0 ? ttdSum / ttdCount : 0;

    // Clean up temp fields
    delete (entry as any)._timeToDecisionSum;
    delete (entry as any)._timeToDecisionCount;

    entry.calculatedAt = new Date().toISOString();
    entry.projectIds = [...projectSet];

    return entry;
  });

  // ── 4. Build summary ───────────────────────────────────────────────────────
  const totalWon = analyticsArray.reduce((s, m) => s + m.projectsWon, 0);
  const totalLost = analyticsArray.reduce((s, m) => s + m.projectsLost, 0);
  const totalNoBid = analyticsArray.reduce((s, m) => s + m.projectsNoBid, 0);
  const totalSubmitted = analyticsArray.reduce((s, m) => s + m.projectsSubmitted, 0);
  const totalProjects = new Set(outcomes.map((o) => o.projectId)).size;
  const totalPipelineValue = analyticsArray.reduce((s, m) => s + m.totalPipelineValue, 0);
  const totalWonValue = analyticsArray.reduce((s, m) => s + m.totalWonValue, 0);
  const totalLostValue = analyticsArray.reduce((s, m) => s + m.totalLostValue, 0);

  const decidedTotal = totalWon + totalLost;
  const averageContractValue = decidedTotal > 0 ? (totalWonValue + totalLostValue) / decidedTotal : 0;

  // Aggregate loss reasons
  const lossReasonCounts: Record<string, number> = {};
  for (const m of analyticsArray) {
    for (const [reason, count] of Object.entries(m.lossReasonCounts)) {
      lossReasonCounts[reason] = (lossReasonCounts[reason] ?? 0) + count;
    }
  }

  // Top loss reason
  const topLossReason = Object.entries(lossReasonCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

  // Average time metrics across months with data
  const monthsWithDecisions = analyticsArray.filter((m) => m.projectsWon + m.projectsLost > 0);
  const averageTimeToDecision = monthsWithDecisions.length > 0
    ? monthsWithDecisions.reduce((s, m) => s + m.averageTimeToDecision, 0) / monthsWithDecisions.length
    : 0;

  const monthsWithSubmissions = analyticsArray.filter((m) => m.projectsSubmitted > 0);
  const averageTimeToSubmit = monthsWithSubmissions.length > 0
    ? monthsWithSubmissions.reduce((s, m) => s + m.averageTimeToSubmit, 0) / monthsWithSubmissions.length
    : 0;

  const summary = {
    totalProjects,
    totalSubmitted,
    totalWon,
    totalLost,
    totalNoBid,
    totalPipelineValue,
    totalWonValue,
    totalLostValue,
    averageContractValue,
    winRate: calculateWinRate(totalWon, totalLost),
    submissionRate: calculateSubmissionRate(totalSubmitted, totalProjects),
    averageTimeToSubmit,
    averageTimeToDecision,
    lossReasonCounts: lossReasonCounts as Record<string, number>,
    topLossReason: topLossReason as string | undefined,
    periodStart: startMonth,
    periodEnd: endMonth,
    monthCount: months.length,
  };

  return apiResponse(200, { analytics: analyticsArray, summary });
};

// ── DynamoDB helpers ──────────────────────────────────────────────────────────

async function fetchOrgOutcomes(orgId: string): Promise<DBProjectOutcome[]> {
  const items: DBProjectOutcome[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const cmd = new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': PROJECT_OUTCOME_PK, ':prefix': orgId },
      ExclusiveStartKey: lastKey,
      Limit: 500,
    });
    const res = await docClient.send(cmd);
    items.push(...((res.Items ?? []) as DBProjectOutcome[]));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

interface ProjectRecord {
  projectId: string;
  createdAt: string;
  submittedAt?: string;
}

async function fetchOrgProjects(orgId: string): Promise<ProjectRecord[]> {
  const items: ProjectRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const cmd = new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': PROJECT_PK, ':prefix': orgId },
      ProjectionExpression: '#sk, createdAt, submittedAt',
      ExclusiveStartKey: lastKey,
      Limit: 500,
    });
    const res = await docClient.send(cmd);
    for (const item of res.Items ?? []) {
      const sk = item[SK_NAME] as string;
      // SK format: orgId#projectId
      const parts = sk.split('#');
      const projectId = parts[1] ?? sk;
      items.push({ projectId, createdAt: item.createdAt as string, submittedAt: item.submittedAt as string | undefined });
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);
