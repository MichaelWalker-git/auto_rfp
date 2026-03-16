import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { queryBySkPrefix } from '@/helpers/db';
import { UNIVERSAL_APPROVAL_PK, DOCUMENT_APPROVAL_PK } from '@/constants/universal-approval';
import { getRFPDocument } from '@/helpers/rfp-document';
import { getProjectById } from '@/helpers/project';
import { getUserByOrgAndId } from '@/helpers/user';
import { getEntityDisplayName, getEntityIcon } from '@auto-rfp/core';
import type { DocumentApprovalItem, UniversalApprovalItem } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

interface AssignedReview {
  approvalId: string;
  orgId: string;
  projectId: string;
  projectName?: string;
  opportunityId?: string;
  documentId?: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  entityIcon?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedByName?: string;
  requestedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  priority?: string;
}

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = event.queryStringParameters?.userId || getUserId(event);
  if (!userId) return apiResponse(400, { message: 'userId is required' });

  try {
    // Get approvals from both universal and legacy systems
    const [universalApprovals, legacyApprovals] = await Promise.all([
      // Universal approvals
      queryBySkPrefix<UniversalApprovalItem>(UNIVERSAL_APPROVAL_PK, orgId).catch(() => []),
      // Legacy document approvals
      queryBySkPrefix<DocumentApprovalItem>(DOCUMENT_APPROVAL_PK, orgId).catch(() => []),
    ]);

    // Filter approvals where the current user is the reviewer
    const userUniversalApprovals = universalApprovals.filter(approval => approval.reviewerId === userId);
    const userLegacyApprovals = legacyApprovals.filter(approval => approval.reviewerId === userId);

    // Enrich universal approvals
    const enrichedUniversalReviews: AssignedReview[] = [];
    for (const approval of userUniversalApprovals) {
      try {
        let projectName: string | undefined;
        let entityName = approval.entityName;

        // Get project info if projectId exists
        if (approval.projectId) {
          const project = await getProjectById(approval.projectId).catch(() => null);
          projectName = project?.name;
        }

        // For RFP documents, get additional document info
        if (approval.entityType === 'rfp-document' && approval.documentId && approval.opportunityId) {
          try {
            const doc = await getRFPDocument(approval.projectId!, approval.opportunityId, approval.documentId);
            if (doc && !doc.deletedAt) {
              entityName = entityName || doc.name || doc.title;
            } else {
              continue; // Skip deleted documents
            }
          } catch (err) {
            console.warn(`Failed to get RFP document ${approval.documentId}:`, err);
            continue;
          }
        }

        // Get requester display name if missing
        let requestedByName = approval.requestedByName;
        if (!requestedByName || requestedByName.includes('-') || requestedByName.length > 50) {
          const requester = await getUserByOrgAndId(orgId, approval.requestedBy).catch(() => null);
          if (requester) {
            requestedByName = requester.displayName || 
              `${requester.firstName || ''} ${requester.lastName || ''}`.trim() || 
              requester.email?.split('@')[0] || 
              'Unknown User';
          }
        }

        enrichedUniversalReviews.push({
          approvalId: approval.approvalId,
          orgId: approval.orgId,
          projectId: approval.projectId || '',
          projectName,
          opportunityId: approval.opportunityId,
          documentId: approval.documentId,
          entityType: approval.entityType,
          entityId: approval.entityId,
          entityName,
          entityIcon: getEntityIcon(approval.entityType),
          status: approval.status as 'PENDING' | 'APPROVED' | 'REJECTED',
          requestedBy: approval.requestedBy,
          requestedByName,
          requestedAt: approval.requestedAt,
          reviewedAt: approval.reviewedAt,
          reviewNote: approval.reviewNote,
          priority: approval.priority || 'NORMAL',
        });
      } catch (err) {
        console.warn(`Failed to enrich universal approval ${approval.approvalId}:`, err);
        // Continue with other approvals
      }
    }

    // Enrich legacy document approvals
    const enrichedLegacyReviews: AssignedReview[] = [];
    for (const approval of userLegacyApprovals) {
      try {
        // Get document info
        const doc = await getRFPDocument(approval.projectId, approval.opportunityId, approval.documentId);
        if (!doc || doc.deletedAt) continue; // Skip deleted documents
        
        // Get project info
        const project = await getProjectById(approval.projectId).catch(() => null);
        
        // Get requester display name if missing
        let requestedByName = approval.requestedByName;
        if (!requestedByName || requestedByName.includes('-') || requestedByName.length > 50) {
          const requester = await getUserByOrgAndId(orgId, approval.requestedBy).catch(() => null);
          if (requester) {
            requestedByName = requester.displayName || 
              `${requester.firstName || ''} ${requester.lastName || ''}`.trim() || 
              requester.email?.split('@')[0] || 
              'Unknown User';
          }
        }
        
        enrichedLegacyReviews.push({
          approvalId: approval.approvalId,
          orgId: approval.orgId,
          projectId: approval.projectId,
          projectName: project?.name,
          opportunityId: approval.opportunityId,
          documentId: approval.documentId,
          entityType: 'rfp-document',
          entityId: approval.documentId,
          entityName: approval.documentName || doc.name || doc.title,
          entityIcon: getEntityIcon('rfp-document'),
          status: approval.status as 'PENDING' | 'APPROVED' | 'REJECTED',
          requestedBy: approval.requestedBy,
          requestedByName,
          requestedAt: approval.requestedAt,
          reviewedAt: approval.reviewedAt,
          reviewNote: approval.reviewNote,
          priority: 'NORMAL', // Legacy approvals don't have priority
        });
      } catch (err) {
        console.warn(`Failed to enrich legacy approval ${approval.approvalId}:`, err);
        // Continue with other approvals
      }
    }

    // Combine and sort all reviews by request date (newest first)
    const allReviews = [...enrichedUniversalReviews, ...enrichedLegacyReviews];
    allReviews.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

    const pendingCount = allReviews.filter(r => r.status === 'PENDING').length;
    const completedCount = allReviews.filter(r => r.status !== 'PENDING').length;

    return apiResponse(200, {
      reviews: allReviews,
      pendingCount,
      completedCount,
    });
  } catch (err) {
    console.error('Error in get-assigned-reviews:', err);
    return apiResponse(500, { message: 'Internal server error' });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);