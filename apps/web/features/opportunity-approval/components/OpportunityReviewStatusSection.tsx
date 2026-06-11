'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { useOpportunityApproval } from '@/lib/hooks/use-universal-approval';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { UniversalApprovalItem } from '@auto-rfp/core';

interface OpportunityReviewStatusSectionProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

export const OpportunityReviewStatusSection = ({
  orgId,
  projectId,
  opportunityId,
}: OpportunityReviewStatusSectionProps) => {
  const { approvals, activeApproval, isLoading } = useOpportunityApproval(orgId, projectId, opportunityId);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Get latest relevant approval (PENDING, APPROVED, or REJECTED)
  const relevantApprovals = useMemo(
    () => approvals.filter(
      (a) => a.status === 'PENDING' || a.status === 'APPROVED' || a.status === 'REJECTED'
    ),
    [approvals]
  );

  // Don't show if loading or no relevant approvals
  if (isLoading || relevantApprovals.length === 0) return null;

  const latestApproval = relevantApprovals[0];
  const isPending = latestApproval.status === 'PENDING';
  const isApproved = latestApproval.status === 'APPROVED';
  const isRejected = latestApproval.status === 'REJECTED';

  // Status display
  const statusText = isPending
    ? 'Approval requested'
    : isApproved
    ? 'Approved'
    : 'Rejected';

  const statusColor = isPending
    ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900 dark:text-amber-300'
    : isApproved
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900 dark:text-emerald-300'
    : 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900 dark:text-red-300';

  const reviewDate = latestApproval.reviewedAt
    ? new Date(latestApproval.reviewedAt)
    : latestApproval.requestedAt
    ? new Date(latestApproval.requestedAt)
    : null;

  return (
    <div className="border-t pt-3 mt-3">
      <div className="space-y-2">
        {/* Status badge and expand button */}
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={`text-sm px-3 py-1 ${statusColor}`}>
            {statusText}
          </Badge>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-7 text-xs"
          >
            {isExpanded ? (
              <>
                Hide details
                <ChevronUp className="h-3 w-3 ml-1" />
              </>
            ) : (
              <>
                View details
                <ChevronDown className="h-3 w-3 ml-1" />
              </>
            )}
          </Button>
        </div>

        {/* Expanded metadata */}
        {isExpanded && (
          <div className="text-sm space-y-3 pt-2">
            <div className="space-y-1">
              {isPending ? (
                <>
                  <div>
                    <span className="text-muted-foreground">Requested by:</span>{' '}
                    <span className="font-medium">{latestApproval.requestedByName ?? 'Unknown'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reviewer:</span>{' '}
                    <span className="font-medium">{latestApproval.reviewerName ?? 'Unknown'}</span>
                  </div>
                  {latestApproval.requestedAt && (
                    <div>
                      <span className="text-muted-foreground">Requested at:</span>{' '}
                      <span>{format(new Date(latestApproval.requestedAt), 'PPP \'at\' p')}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <span className="text-muted-foreground">Reviewed by:</span>{' '}
                    <span className="font-medium">{latestApproval.reviewerName ?? 'Unknown'}</span>
                  </div>
                  {reviewDate && (
                    <div>
                      <span className="text-muted-foreground">Date:</span>{' '}
                      <span>{format(reviewDate, 'PPP \'at\' p')}</span>
                    </div>
                  )}
                  {latestApproval.requestedByName && (
                    <div>
                      <span className="text-muted-foreground">Requested by:</span>{' '}
                      <span>{latestApproval.requestedByName}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Review comments */}
            {latestApproval.reviewNote && (
              <div>
                <div className="text-sm font-medium mb-1.5">Comments</div>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                  {latestApproval.reviewNote}
                </div>
              </div>
            )}

            {/* Previous reviews - collapsed by default */}
            {relevantApprovals.length > 1 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHistory(!showHistory)}
                    className="h-7 text-xs w-full justify-between"
                  >
                    <span>
                      Previous Review{relevantApprovals.length > 2 ? 's' : ''} ({relevantApprovals.length - 1})
                    </span>
                    {showHistory ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </Button>

                  {showHistory && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {relevantApprovals.slice(1).map((approval) => {
                        const isPendingOld = approval.status === 'PENDING';
                        const isApprovedOld = approval.status === 'APPROVED';
                        const reviewDateOld = approval.reviewedAt
                          ? new Date(approval.reviewedAt)
                          : approval.requestedAt
                          ? new Date(approval.requestedAt)
                          : null;

                        return (
                          <div key={approval.approvalId} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                            {/* Status badge */}
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                isPendingOld
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : isApprovedOld
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-red-50 text-red-700 border-red-200'
                              }`}
                            >
                              {isPendingOld ? 'Requested' : isApprovedOld ? 'Approved' : 'Rejected'}
                            </Badge>

                            {/* Metadata */}
                            <div className="text-xs space-y-1">
                              {isPendingOld ? (
                                <>
                                  <div>
                                    <span className="text-muted-foreground">Requested by:</span>{' '}
                                    <span>{approval.requestedByName ?? 'Unknown'}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Reviewer:</span>{' '}
                                    <span>{approval.reviewerName ?? 'Unknown'}</span>
                                  </div>
                                  {approval.requestedAt && (
                                    <div>
                                      <span className="text-muted-foreground">Requested:</span>{' '}
                                      <span>{format(new Date(approval.requestedAt), 'MMM d, yyyy')}</span>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <div>
                                    <span className="text-muted-foreground">Reviewed by:</span>{' '}
                                    <span>{approval.reviewerName ?? 'Unknown'}</span>
                                  </div>
                                  {reviewDateOld && (
                                    <div>
                                      <span className="text-muted-foreground">Date:</span>{' '}
                                      <span>{format(reviewDateOld, 'MMM d, yyyy')}</span>
                                    </div>
                                  )}
                                  {approval.requestedByName && (
                                    <div>
                                      <span className="text-muted-foreground">Requested by:</span>{' '}
                                      <span>{approval.requestedByName}</span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>

                            {/* Comments */}
                            {approval.reviewNote && (
                              <div className="text-xs">
                                <div className="font-medium mb-1">Comments</div>
                                <div className="text-muted-foreground whitespace-pre-wrap">
                                  {approval.reviewNote}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
