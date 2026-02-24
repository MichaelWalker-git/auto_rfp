import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DeleteCommand, } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { KNOWLEDGE_BASE_PK } from '@/constants/organization';
import { apiResponse, getOrgId } from '@/helpers/api';
import { deleteItem, docClient } from '@/helpers/db';
import { deleteAllLinksForKB } from '@/helpers/project-kb';
import { deleteAllDocumentsInKB } from '@/helpers/kb';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const tokenOrgId = getOrgId(event);
    const { orgId: bodyOrgId, id: kbId} = JSON.parse(event.body || '');
    const orgId = tokenOrgId ? tokenOrgId : bodyOrgId;

    const sk = `${orgId}#${kbId}`;

    try {
      await deleteItem(KNOWLEDGE_BASE_PK, sk);
    } catch (err: any) {
      console.error('Error deleting knowledge base:', err);
      return apiResponse(500, {
        message: 'Failed to delete knowledge base',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    // Cascade 1: Delete all documents in this KB
    let deletedDocuments = 0;
    try {
      deletedDocuments = await deleteAllDocumentsInKB(kbId);
      if (deletedDocuments > 0) {
        console.log(`Cascade deleted ${deletedDocuments} documents for kbId=${kbId}`);
      }
    } catch (cascadeErr) {
      // Log but don't fail the main operation
      console.warn('Failed to cascade delete documents:', (cascadeErr as Error)?.message);
    }

    // Cascade 2: Clean up any PROJECT_KB links referencing this KB
    let deletedLinks = 0;
    try {
      deletedLinks = await deleteAllLinksForKB(kbId);
      if (deletedLinks > 0) {
        console.log(`Cascade deleted ${deletedLinks} PROJECT_KB links for kbId=${kbId}`);
      }
    } catch (cascadeErr) {
      // Log but don't fail the main operation
      console.warn('Failed to cascade delete PROJECT_KB links:', (cascadeErr as Error)?.message);
    }

    
    setAuditContext(event, {
      action: 'ORG_SETTINGS_CHANGED',
      resource: 'knowledge_base',
      resourceId: event.pathParameters?.kbId ?? event.queryStringParameters?.kbId ?? 'unknown',
    });

    return apiResponse(200, {
      message: 'Knowledge base deleted successfully',
      orgId,
      kbId,
      cascadeDeleted: {
        documents: deletedDocuments,
        projectLinks: deletedLinks,
      },
    });
  } catch (err) {
    console.error('Unhandled error in deleteKnowledgeBase handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
