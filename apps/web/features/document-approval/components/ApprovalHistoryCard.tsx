'use client';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, ClipboardCheck } from 'lucide-react';
import { useApprovalHistory } from '../hooks/useApprovalHistory';
import { ApprovalStatusBadge } from './ApprovalStatusBadge';
import { ReviewDecisionPanel } from './ReviewDecisionPanel';

interface ApprovalHistoryCardProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  currentUserId: string;
  onReviewComplete?: () => void;
}

export const ApprovalHistoryCard = ({
  orgId,
  projectId,
  opportunityId,
  documentId,
  currentUserId,
  onReviewComplete,
}: ApprovalHistoryCardProps) => {
  const { approvals, count, activeApproval, isLoading, refresh } = useApprovalHistory(
    orgId,
    projectId,
    opportunityId,
    documentId,
  );

  const handleReviewComplete = () => {
    refresh();
    onReviewComplete?.();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (count === 0) return null;

  return (
    <div className="space-y-3">
      {/* Review decision panel — only visible to the assigned reviewer */}
      {activeApproval && (
        <ReviewDecisionPanel
          approval={activeApproval}
          currentUserId={currentUserId}
          onSuccess={handleReviewComplete}
        />
      )}

      {/* Approval history */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Approval History
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {count} request{count !== 1 ? 's' : ''}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {approvals.map((approval) => (
              <div
                key={approval.approvalId}
                className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ApprovalStatusBadge status={approval.status} />
                    <span className="text-xs text-muted-foreground">
                      Requested by {approval.requestedByName ?? approval.requestedBy}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(approval.requestedAt), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Reviewer: <span className="font-medium">{approval.reviewerName ?? approval.reviewerEmail ?? approval.reviewerId}</span>
                  </p>

                  {approval.reviewedAt && (
                    <p className="text-xs text-muted-foreground">
                      Reviewed: {format(new Date(approval.reviewedAt), 'MMM d, yyyy HH:mm')}
                    </p>
                  )}

                  {approval.reviewNote && (
                    <p className="text-xs text-muted-foreground italic">
                      "{approval.reviewNote}"
                    </p>
                  )}

                  {approval.linearTicketUrl && (
                    <a
                      href={approval.linearTicketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {approval.linearTicketIdentifier
                        ? `Linear ${approval.linearTicketIdentifier}`
                        : 'View in Linear'}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
