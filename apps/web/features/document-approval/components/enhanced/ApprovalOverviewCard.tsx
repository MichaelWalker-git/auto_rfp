'use client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, CheckCircle2, XCircle, AlertCircle, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { EnhancedDocumentApprovalItem } from '@auto-rfp/core';

interface ApprovalOverviewCardProps {
  approval: EnhancedDocumentApprovalItem;
  currentUserId: string;
  showActions?: boolean;
}

export const ApprovalOverviewCard = ({
  approval,
  currentUserId,
  showActions = true,
}: ApprovalOverviewCardProps) => {
  const isRequester = approval.requestedBy === currentUserId;
  const isReviewer = approval.reviewerId === currentUserId;
  const isPending = approval.status === 'PENDING';

  const statusConfig = {
    PENDING: {
      icon: Clock,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      label: 'Pending Review',
    },
    APPROVED: {
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      label: 'Approved',
    },
    REJECTED: {
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      label: 'Rejected',
    },
    REVISION_REQUESTED: {
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      label: 'Revision Requested',
    },
    CANCELLED: {
      icon: XCircle,
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      borderColor: 'border-gray-200',
      label: 'Cancelled',
    },
  };

  const config = statusConfig[approval.status] || statusConfig.PENDING;
  const StatusIcon = config.icon;

  return (
    <Card className={`${config.borderColor} ${config.bgColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${config.bgColor} ${config.borderColor} border`}>
              <StatusIcon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div>
              <h3 className="font-semibold text-base">{config.label}</h3>
              <p className="text-sm text-muted-foreground">
                {approval.documentName || 'Document approval'}
              </p>
            </div>
          </div>
          
          {approval.priority !== 'NORMAL' && (
            <Badge 
              variant={approval.priority === 'URGENT' ? 'destructive' : 'secondary'}
              className="text-xs"
            >
              {approval.priority}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Participants */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Requester */}
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={approval.requesterInfo?.avatar} />
              <AvatarFallback className="text-xs">
                {approval.requesterInfo?.name?.charAt(0) || 
                 approval.requestedByName?.charAt(0) || 
                 <User className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {approval.requesterInfo?.name || approval.requestedByName || 'Unknown'}
                {isRequester && <span className="text-muted-foreground ml-1">(You)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                Requested {formatDistanceToNow(new Date(approval.requestedAt), { addSuffix: true })}
              </p>
            </div>
          </div>

          {/* Reviewer */}
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={approval.reviewerInfo?.avatar} />
              <AvatarFallback className="text-xs">
                {approval.reviewerInfo?.name?.charAt(0) || 
                 approval.reviewerName?.charAt(0) || 
                 <User className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {approval.reviewerInfo?.name || approval.reviewerName || 'Unknown'}
                {isReviewer && <span className="text-muted-foreground ml-1">(You)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {approval.reviewerInfo?.role || 'Reviewer'}
                {approval.reviewerInfo?.department && ` • ${approval.reviewerInfo.department}`}
              </p>
            </div>
          </div>
        </div>

        {/* Review Details */}
        {approval.reviewedAt && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1">
              Reviewed {formatDistanceToNow(new Date(approval.reviewedAt), { addSuffix: true })}
              {approval.timeToReview && (
                <span className="ml-2">
                  • Review time: {Math.round(approval.timeToReview / 60)}h {approval.timeToReview % 60}m
                </span>
              )}
            </p>
            {approval.reviewNote && (
              <div className={`text-sm p-3 rounded-lg ${
                approval.status === 'APPROVED' 
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                <p className="font-medium text-xs mb-1">
                  {approval.status === 'APPROVED' ? 'Approval Note:' : 'Rejection Reason:'}
                </p>
                <p>{approval.reviewNote}</p>
              </div>
            )}
          </div>
        )}

        {/* Deadline Warning */}
        {approval.deadline && isPending && (
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs">
              Deadline: {formatDistanceToNow(new Date(approval.deadline), { addSuffix: true })}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};