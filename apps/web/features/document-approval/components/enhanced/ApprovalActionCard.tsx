'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  User,
  ArrowRight 
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ReviewDecisionPanel } from '../ReviewDecisionPanel';
import { ResubmitForReviewButton } from '../ResubmitForReviewButton';
import { RequestApprovalButton } from '../RequestApprovalButton';
import type { EnhancedDocumentApprovalItem } from '@auto-rfp/core';

/**
 * Helper to resolve a human-readable display name.
 * Returns the stored name only when it looks like a real name (not a raw UUID/ID).
 */
const resolveDisplayName = (
  name: string | undefined,
  fallback = 'Unknown',
): string => {
  if (!name) return fallback;
  if (name.length > 50 || /^[0-9a-f]{8}-/.test(name)) return fallback;
  return name;
};

interface ApprovalActionCardProps {
  approval: EnhancedDocumentApprovalItem | null;
  approvals: EnhancedDocumentApprovalItem[];
  currentUserId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  documentName?: string;
  onActionComplete?: () => void;
}

export const ApprovalActionCard = ({
  approval,
  approvals,
  currentUserId,
  orgId,
  projectId,
  opportunityId,
  documentId,
  documentName,
  onActionComplete,
}: ApprovalActionCardProps) => {
  // Find the most recent rejected approval where current user is the requester
  const latestRejected = approvals.find(
    (a) => a.status === 'REJECTED' && a.requestedBy === currentUserId,
  );

  // Determine user's role and required action
  const isReviewer = approval && approval.reviewerId === currentUserId;
  const isRequester = approval && approval.requestedBy === currentUserId;
  const needsReview = approval && approval.status === 'PENDING' && isReviewer;
  const needsResubmit = latestRejected && !approval;
  const needsInitialRequest = !approval && approvals.length === 0;

  // Don't show if no action is needed
  if (!needsReview && !needsResubmit && !needsInitialRequest) {
    return null;
  }

  const getActionConfig = () => {
    if (needsReview) {
      return {
        title: 'Your Review Required',
        description: `${resolveDisplayName(approval!.requesterInfo?.name || approval!.requestedByName, 'A team member')} is waiting for your approval`,
        icon: Clock,
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-200',
        urgency: approval!.isOverdue ? 'OVERDUE' : approval!.priority,
      };
    }
    
    if (needsResubmit) {
      return {
        title: 'Document Rejected',
        description: `${resolveDisplayName(latestRejected!.reviewerInfo?.name || latestRejected!.reviewerName, 'The reviewer')} rejected this document`,
        icon: XCircle,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        urgency: 'HIGH',
      };
    }

    return {
      title: 'Request Approval',
      description: 'This document needs approval before it can be submitted',
      icon: User,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      urgency: 'NORMAL',
    };
  };

  const config = getActionConfig();
  const ActionIcon = config.icon;

  return (
    <Card className={`${config.borderColor} ${config.bgColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${config.bgColor} ${config.borderColor} border`}>
              <ActionIcon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{config.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {config.description}
              </p>
            </div>
          </div>
          
          {config.urgency !== 'NORMAL' && (
            <Badge 
              variant={config.urgency === 'OVERDUE' || config.urgency === 'URGENT' ? 'destructive' : 'secondary'}
              className="text-xs"
            >
              {config.urgency}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {needsReview && approval && (
          <div className="space-y-4">
            {/* Requester info */}
            <div className="flex items-center gap-3 p-3 bg-background rounded-lg border">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {resolveDisplayName(approval.requesterInfo?.name || approval.requestedByName).charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {resolveDisplayName(approval.requesterInfo?.name || approval.requestedByName)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Requested {formatDistanceToNow(new Date(approval.requestedAt), { addSuffix: true })}
                  {approval.requesterInfo?.department && ` • ${approval.requesterInfo.department}`}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="text-right">
                <p className="text-sm font-medium">You</p>
                <p className="text-xs text-muted-foreground">Reviewer</p>
              </div>
            </div>

            {/* Review panel */}
            <ReviewDecisionPanel
              approval={approval}
              currentUserId={currentUserId}
              onSuccess={onActionComplete}
            />
          </div>
        )}

        {needsResubmit && latestRejected && (
          <div className="space-y-4">
            {/* Rejection details */}
            <div className="p-3 bg-background rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-red-800">Rejection Reason</span>
              </div>
              <p className="text-sm text-red-700">
                {latestRejected.reviewNote || 'No reason provided'}
              </p>
            </div>

            {/* Re-submit button */}
            <ResubmitForReviewButton
              approval={latestRejected}
              currentUserId={currentUserId}
              onSuccess={onActionComplete}
            />
          </div>
        )}

        {needsInitialRequest && (
          <RequestApprovalButton
            orgId={orgId}
            projectId={projectId}
            opportunityId={opportunityId}
            documentId={documentId}
            documentName={documentName}
            onSuccess={onActionComplete}
          />
        )}
      </CardContent>
    </Card>
  );
};