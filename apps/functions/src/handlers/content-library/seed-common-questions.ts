import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { ContentLibraryItem } from '@auto-rfp/core';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  createContentLibrarySK,
} from '@auto-rfp/core';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { docClient, queryBySkPrefix, type DBItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { indexContentLibrary } from '@/helpers/content-library';
import { COMMON_RFP_QUESTIONS } from './common-rfp-questions';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/** Maximum items per DynamoDB BatchWrite request */
const BATCH_SIZE = 25;

/**
 * Seed common RFP questions into an organization's Content Library.
 * POST /api/content-library/seed-common-questions
 *
 * Body: { orgId: string, priority?: "HIGH" | "MEDIUM" | "ALL" }
 *
 * Creates DRAFT items that the org admin can review, customize, and approve.
 * Skips questions that already exist (matched by exact question text).
 */
const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const orgId = body.orgId || getOrgId(event);

    if (!orgId) {
      return apiResponse(400, { error: 'orgId is required' });
    }

    const priority: string = body.priority || 'ALL';
    if (!['HIGH', 'MEDIUM', 'ALL'].includes(priority)) {
      return apiResponse(400, { error: 'priority must be HIGH, MEDIUM, or ALL' });
    }

    const userId = getUserId(event) ?? 'system';
    const now = nowIso();

    // Fetch existing content library items for this org to deduplicate
    const existingItems = await queryBySkPrefix<{ question?: string }>(
      CONTENT_LIBRARY_PK,
      `${orgId}#`,
    );
    const existingQuestions = new Set(
      existingItems.map((item) => item.question?.toLowerCase().trim()),
    );

    // Filter questions by priority
    const questionsToSeed = COMMON_RFP_QUESTIONS.filter((q) => {
      if (priority !== 'ALL' && q.priority !== priority) return false;
      // Skip if an item with the same question text already exists
      return !existingQuestions.has(q.question.toLowerCase().trim());
    });

    if (questionsToSeed.length === 0) {
      return apiResponse(200, {
        message: 'No new questions to seed — all common questions already exist in the library.',
        created: 0,
        skipped: COMMON_RFP_QUESTIONS.length,
      });
    }

    // Build DynamoDB items
    const dbItems = questionsToSeed.map((q) => {
      const itemId = uuidv4();
      const sk = createContentLibrarySK(orgId, itemId);

      return {
        PutRequest: {
          Item: {
            [PK_NAME]: CONTENT_LIBRARY_PK,
            [SK_NAME]: sk,
            id: itemId,
            orgId,
            question: q.question,
            answer: q.answerTemplate,
            category: q.category,
            tags: [...q.tags, `priority-${q.priority.toLowerCase()}`],
            description: `Common RFP question (${q.priority} priority). Review and customize the answer template before approving.`,
            sources: [],
            usageCount: 0,
            lastUsedAt: null,
            usedInProjectIds: [],
            currentVersion: 1,
            versions: [{
              version: 1,
              text: q.answerTemplate,
              createdAt: now,
              createdBy: userId,
              changeNotes: 'Seeded from common RFP questions template',
            }],
            isArchived: false,
            archivedAt: null,
            confidenceScore: undefined,
            approvalStatus: 'DRAFT',
            approvedBy: null,
            approvedAt: null,
            freshnessStatus: 'ACTIVE',
            certExpiryDate: null,
            staleSince: null,
            staleReason: null,
            lastFreshnessCheck: null,
            reactivatedAt: null,
            reactivatedBy: null,
            createdAt: now,
            updatedAt: now,
            createdBy: userId,
          },
        },
      };
    });

    // Write in batches of 25 (DynamoDB BatchWriteItem limit)
    let written = 0;
    for (let i = 0; i < dbItems.length; i += BATCH_SIZE) {
      const batch = dbItems.slice(i, i + BATCH_SIZE);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: batch,
          },
        }),
      );
      written += batch.length;
    }

    // Index each item in Pinecone so semantic search can find them
    // during answer generation. Failures are logged but don't block the response.
    let indexed = 0;
    for (const entry of dbItems) {
      try {
        const item = entry.PutRequest.Item as ContentLibraryItem & DBItem;
        await indexContentLibrary(orgId, item);
        indexed++;
      } catch (err) {
        console.warn(
          `Failed to index content library item ${entry.PutRequest.Item.id} in Pinecone:`,
          err,
        );
      }
    }

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: 'seed-common-questions',
    });

    return apiResponse(201, {
      message: `Seeded ${written} common RFP questions into the content library (${indexed} indexed in Pinecone).`,
      created: written,
      indexed,
      skipped: COMMON_RFP_QUESTIONS.length - questionsToSeed.length,
      note: 'Items are created as DRAFT. Review, customize answers, and approve them via the Content Library UI.',
    });
  } catch (error) {
    console.error('Error seeding common questions:', error);
    return apiResponse(500, {
      error: 'Failed to seed common questions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
