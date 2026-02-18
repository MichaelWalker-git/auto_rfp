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
 */
async function queryDeadlines(
    orgId?: string,
    projectId?: string,
    urgentOnly?: boolean
): Promise<any[]> {
    let keyConditionExpression = '#pk = :pk';
    const expressionAttributeValues: any = {
        ':pk': 'DEADLINE',
    };
    const expressionAttributeNames: any = {
        '#pk': PK_NAME,
    };

    // If we have orgId and projectId, query specific project
    if (orgId && projectId) {
        keyConditionExpression += ' AND #sk = :sk';
        expressionAttributeNames['#sk'] = SK_NAME;
        expressionAttributeValues[':sk'] = `${orgId}#${projectId}`;
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

// Handler

export const baseHandler = async (
    event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
    try {
        const params = event.queryStringParameters || {};
        const { orgId, projectId, urgentOnly } = RequestSchema.parse(params);

        const deadlines = await queryDeadlines(
            orgId,
            projectId,
            urgentOnly
        );

        return apiResponse(200, {
            ok: true,
            count: deadlines.length,
            deadlines,
            filters: {
                orgId: orgId || 'all',
                projectId: projectId || 'all',
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