import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApprovalHistory } from '@/helpers/document-approval';
import { getUserByOrgAndId } from '@/helpers/user';
import type { 
  DocumentApprovalItem,
  EnhancedDocumentApprovalItem, 
  EnhancedApprovalHistoryResponse 
} from '@auto-rfp/core';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';

const enrichApprovalWithUserInfo = async (
  approval: DocumentApprovalItem,
  orgId: string,
): Promise<EnhancedDocumentApprovalItem> => {
  // Get requester info
  const requesterInfo = await getUserByOrgAndId(orgId, approval.requestedBy).catch(() => null);
  
  // Get reviewer info
  const reviewerInfo = await getUserByOrgAndId(orgId, approval.reviewerId).catch(() => null);
  
  // Calculate time to review if completed
  let timeToReview: number | undefined;
  if (approval.reviewedAt) {
    const requestTime = new Date(approval.requestedAt).getTime();
    const reviewTime = new Date(approval.reviewedAt).getTime();
    timeToReview = Math.round((reviewTime - requestTime) / (1000 * 60)); // minutes
  }
  
  // Check if overdue (assuming 48 hours is the default deadline)
  const isOverdue = approval.status === 'PENDING' && 
    new Date().getTime() - new Date(approval.requestedAt).getTime() > 48 * 60 * 60 * 1000;

  return {
    ...approval,
    requesterInfo: requesterInfo ? {
      userId: requesterInfo.userId,
      name: requesterInfo.displayName || `${requesterInfo.firstName || ''} ${requesterInfo.lastName || ''}`.trim() || undefined,
      email: requesterInfo.email,
      avatar: undefined, // Not available in current user schema
      role: undefined, // Not available in current user schema
      department: undefined, // Not available in current user schema
    } : undefined,
    reviewerInfo: reviewerInfo ? {
      userId: reviewerInfo.userId,
      name: reviewerInfo.displayName || `${reviewerInfo.firstName || ''} ${reviewerInfo.lastName || ''}`.trim() || undefined,
      email: reviewerInfo.email,
      avatar: undefined, // Not available in current user schema
      role: undefined, // Not available in current user schema
      department: undefined, // Not available in current user schema
    } : undefined,
    timeToReview,
    isOverdue,
    priority: 'NORMAL', // Default priority since not in current schema
    tags: [], // Default empty tags since not in current schema
  };
};

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { projectId, opportunityId, documentId } = event.queryStringParameters ?? {};
  if (!projectId || !opportunityId || !documentId) {
    return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
  }

  const currentUserId = getUserId(event) ?? 'system';

  // Get basic approval history
  const history = await getApprovalHistory(orgId, projectId, opportunityId, documentId);
  
  // Enrich with user information
  const enrichedApprovals = await Promise.all(
    history.items.map(approval => enrichApprovalWithUserInfo(approval, orgId))
  );

  // Calculate summary statistics
  const totalPending = enrichedApprovals.filter((a: EnhancedDocumentApprovalItem) => a.status === 'PENDING').length;
  const totalApproved = enrichedApprovals.filter((a: EnhancedDocumentApprovalItem) => a.status === 'APPROVED').length;
  const totalRejected = enrichedApprovals.filter((a: EnhancedDocumentApprovalItem) => a.status === 'REJECTED').length;
  const overdueCount = enrichedApprovals.filter((a: EnhancedDocumentApprovalItem) => a.isOverdue).length;
  
  const completedApprovals = enrichedApprovals.filter((a: EnhancedDocumentApprovalItem) => a.timeToReview);
  const averageReviewTime = completedApprovals.length > 0 
    ? Math.round(completedApprovals.reduce((sum: number, a: EnhancedDocumentApprovalItem) => sum + (a.timeToReview || 0), 0) / completedApprovals.length)
    : undefined;

  // Determine user context
  const activeApproval = enrichedApprovals.find((a: EnhancedDocumentApprovalItem) => a.status === 'PENDING');
  const isRequester = activeApproval?.requestedBy === currentUserId;
  const isReviewer = activeApproval?.reviewerId === currentUserId;
  const hasActionItems = isReviewer || (isRequester && enrichedApprovals.some((a: EnhancedDocumentApprovalItem) => a.status === 'REJECTED'));
  
  let nextAction: string | undefined;
  if (isReviewer && activeApproval) {
    nextAction = 'Review and approve/reject document';
  } else if (isRequester && enrichedApprovals.some((a: EnhancedDocumentApprovalItem) => a.status === 'REJECTED')) {
    nextAction = 'Address feedback and re-submit for review';
  } else if (!activeApproval && enrichedApprovals.length === 0) {
    nextAction = 'Request approval from a team member';
  }

  const response: EnhancedApprovalHistoryResponse = {
    items: enrichedApprovals,
    count: enrichedApprovals.length,
    activeApproval: activeApproval ? await enrichApprovalWithUserInfo(activeApproval, orgId) : null,
    summary: {
      totalPending,
      totalApproved,
      totalRejected,
      averageReviewTime,
      overdueCount,
    },
    userContext: {
      isRequester,
      isReviewer,
      hasActionItems,
      nextAction,
    },
  };

  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);