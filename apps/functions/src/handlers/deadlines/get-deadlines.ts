import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import {
    calculateDaysUntil,
    getWarningLevel,
    calculateRecommendedSubmitBy
} from '@/helpers/deadline-calculations';
import {withSentryLambda} from '@/sentry-lambda';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME!;

const RequestSchema = z.object({
    orgId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    opportunityId: z.string().min(1).optional(),
    urgentOnly: z.coerce.boolean().optional(),
});

// Helpers

/**
 * Enrich a single deadline item with calculated fields
 */
function enrichDeadlineItem(item: any): any {
    const enriched = { ...item };

    // Enrich each deadline in the array
    if (item.deadlines && Array.isArray(item.deadlines)) {
        enriched.deadlines = item.deadlines.map((deadline: any) => {
            const daysUntil = calculateDaysUntil(deadline.dateTimeIso);
            const warningLevel = getWarningLevel(daysUntil);

            return {
                ...deadline,
                daysUntil,
                warningLevel,
            };
        });
    }

    // Enrich submission deadline
    if (item.submissionDeadlineIso) {
        const daysUntil = calculateDaysUntil(item.submissionDeadlineIso);
        const warningLevel = getWarningLevel(daysUntil);

        enriched.submissionDeadline = {
            dateTimeIso: item.submissionDeadlineIso,
            daysUntil,
            warningLevel,
            recommendedSubmitBy: calculateRecommendedSubmitBy(item.submissionDeadlineIso),
        };
    }

    return enriched;
}

/**
 * Check if deadline item has any urgent deadlines
 */
function hasUrgentDeadlines(item: any): boolean {
    // Check submission deadline
    if (item.submissionDeadline?.warningLevel === 'urgent') {
        return true;
    }

    // Check deadlines array
    if (item.deadlines && Array.isArray(item.deadlines)) {
        return item.deadlines.some((d: any) => d.warningLevel === 'urgent');
    }

    return false;
}

/**
 * Query deadlines from DEADLINE table
 * SK format: `${orgId}#${projectId}#${opportunityId}` or `${orgId}#${projectId}` for legacy
 */
async function queryDeadlines(
    orgId?: string,
    projectId?: string,
    opportunityId?: string,
    urgentOnly?: boolean
): Promise<any[]> {
    let keyConditionExpression = '#pk = :pk';
    const expressionAttributeValues: any = {
        ':pk': 'DEADLINE',
    };
    const expressionAttributeNames: any = {
        '#pk': PK_NAME,
    };

    // Build SK prefix based on provided parameters
    if (orgId && projectId && opportunityId) {
        // Query specific opportunity
        keyConditionExpression += ' AND #sk = :sk';
        expressionAttributeNames['#sk'] = SK_NAME;
        expressionAttributeValues[':sk'] = `${orgId}#${projectId}#${opportunityId}`;
    } else if (orgId && projectId) {
        // Query all opportunities for a project (prefix match)
        keyConditionExpression += ' AND begins_with(#sk, :skPrefix)';
        expressionAttributeNames['#sk'] = SK_NAME;
        expressionAttributeValues[':skPrefix'] = `${orgId}#${projectId}#`;
    } else if (orgId) {
        // Query all projects for an org
        keyConditionExpression += ' AND begins_with(#sk, :orgPrefix)';
        expressionAttributeNames['#sk'] = SK_NAME;
        expressionAttributeValues[':orgPrefix'] = `${orgId}#`;
    }

    const result = await ddb.send(
        new QueryCommand({
            TableName: DB_TABLE_NAME,
            KeyConditionExpression: keyConditionExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
        })
    );

    let deadlines = result.Items || [];

    // Enrich all items with calculated fields
    deadlines = deadlines.map(enrichDeadlineItem);

    // Filter if only projectId provided
    if (projectId && !orgId) {
        deadlines = deadlines.filter(deadline => deadline.projectId === projectId);
    }

    // Filter for urgent deadlines if requested
    if (urgentOnly) {
        deadlines = deadlines.filter(hasUrgentDeadlines);
    }

    return deadlines;
}

/**
 * Query opportunities that have decisionDateIso or contractStartDateIso
 * and create synthetic deadline entries for the calendar.
 */
async function queryOpportunityDecisionDates(
    orgId?: string,
    projectId?: string,
    opportunityId?: string,
): Promise<any[]> {
    if (!orgId) return [];

    let keyConditionExpression = '#pk = :pk';
    const expressionAttributeValues: Record<string, string> = { ':pk': 'OPPORTUNITY' };
    const expressionAttributeNames: Record<string, string> = { '#pk': PK_NAME };

    if (orgId && projectId && opportunityId) {
        keyConditionExpression += ' AND #sk = :sk';
        expressionAttributeNames['#sk'] = SK_NAME;
        expressionAttributeValues[':sk'] = `${orgId}#${projectId}#${opportunityId}`;
    } else if (orgId && projectId) {
        keyConditionExpression += ' AND begins_with(#sk, :skPrefix)';
        expressionAttributeNames['#sk'] = SK_NAME;
        expressionAttributeValues[':skPrefix'] = `${orgId}#${projectId}#`;
    } else if (orgId) {
        keyConditionExpression += ' AND begins_with(#sk, :orgPrefix)';
        expressionAttributeNames['#sk'] = SK_NAME;
        expressionAttributeValues[':orgPrefix'] = `${orgId}#`;
    }

    expressionAttributeNames['#dd'] = 'decisionDateIso';
    expressionAttributeNames['#cs'] = 'contractStartDateIso';

    const result = await ddb.send(
        new QueryCommand({
            TableName: DB_TABLE_NAME,
            KeyConditionExpression: keyConditionExpression,
            FilterExpression: 'attribute_exists(#dd) OR attribute_exists(#cs)',
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
        })
    );

    const syntheticDeadlines: any[] = [];

    for (const item of result.Items ?? []) {
        const decisionDate = item.decisionDateIso as string | undefined;
        const contractStart = item.contractStartDateIso as string | undefined;

        if (!decisionDate && !contractStart) continue;

        const dateIso = decisionDate || contractStart;
        const type = decisionDate ? 'DECISION_DATE' : 'CONTRACT_START';
        const label = decisionDate ? 'Decision Date' : 'Contract Start (fallback)';

        const daysUntil = calculateDaysUntil(dateIso);
        const warningLevel = getWarningLevel(daysUntil);

        syntheticDeadlines.push({
            [PK_NAME]: 'DEADLINE',
            [SK_NAME]: `${item.orgId ?? orgId}#${item.projectId ?? projectId}#${item.oppId ?? item.id}#${type}`,
            orgId: item.orgId ?? orgId,
            projectId: item.projectId ?? projectId,
            opportunityId: item.oppId ?? item.id,
            opportunityTitle: item.title,
            deadlines: [{
                type,
                label,
                dateTimeIso: dateIso,
                rawText: label,
                daysUntil,
                warningLevel,
            }],
        });
    }

    return syntheticDeadlines;
}

// Handler

export const baseHandler = async (
    event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
    try {
        const params = event.queryStringParameters || {};
        const { orgId, projectId, opportunityId, urgentOnly } = RequestSchema.parse(params);

        const [deadlines, decisionDateDeadlines] = await Promise.all([
            queryDeadlines(orgId, projectId, opportunityId, urgentOnly),
            queryOpportunityDecisionDates(orgId, projectId, opportunityId),
        ]);

        // Deduplicate: skip synthetic decision dates if AI already extracted one for the same opportunity
        const oppIdsWithAiDecisionDate = new Set<string>();
        for (const d of deadlines) {
            if (d.deadlines?.some((dl: any) => dl.type === 'DECISION_DATE' || dl.type === 'AWARD_ESTIMATE')) {
                if (d.opportunityId) oppIdsWithAiDecisionDate.add(d.opportunityId);
            }
        }

        const deduplicatedDecisionDates = decisionDateDeadlines.filter(
            (d: any) => !oppIdsWithAiDecisionDate.has(d.opportunityId),
        );

        const filteredDecisionDates = urgentOnly
            ? deduplicatedDecisionDates.filter(hasUrgentDeadlines)
            : deduplicatedDecisionDates;

        const allDeadlines = [...deadlines, ...filteredDecisionDates];

        return apiResponse(200, {
            ok: true,
            count: allDeadlines.length,
            deadlines: allDeadlines,
            filters: {
                orgId: orgId || 'all',
                projectId: projectId || 'all',
                opportunityId: opportunityId || 'all',
                urgentOnly: urgentOnly || false,
            },
        });

    } catch (err) {
        console.error('get-deadlines error:', err);
        return apiResponse(500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        });
    }
};

// export const handler = baseHandler;
export const handler = withSentryLambda(baseHandler);