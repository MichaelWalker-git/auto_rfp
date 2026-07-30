'use client';

import { format } from 'date-fns';
import { Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { UniversalApprovalItem } from '@auto-rfp/core';

interface ReviewDecisionCardProps {
  approval: UniversalApprovalItem;
}

export const ReviewDecisionCard = ({ approval }: ReviewDecisionCardProps) => {
  const isApproved = approval.status === 'APPROVED';
  const reviewDate = approval.reviewedAt ? new Date(approval.reviewedAt) : null;

  return (
    <div className="space-y-3">
      {/* Status Badge */}
      <Badge
        variant={isApproved ? 'default' : 'destructive'}
        className="text-sm px-3 py-1"
      >
        {isApproved ? (
          <Check className="h-4 w-4 mr-1" />
        ) : (
          <X className="h-4 w-4 mr-1" />
        )}
        {isApproved ? 'APPROVED' : 'REJECTED'}
      </Badge>

      {/* Review Metadata */}
      <div className="text-sm space-y-1">
        <div>
          <span className="text-muted-foreground">Reviewed by:</span>{' '}
          <span className="font-medium">{approval.reviewerName ?? 'Unknown'}</span>
        </div>
        {reviewDate && (
          <div>
            <span className="text-muted-foreground">Date:</span>{' '}
            <span>{format(reviewDate, 'PPP \'at\' p')}</span>
          </div>
        )}
        {approval.requestedByName && (
          <div>
            <span className="text-muted-foreground">Requested by:</span>{' '}
            <span>{approval.requestedByName}</span>
          </div>
        )}
      </div>

      {/* Review Comments */}
      {approval.reviewNote && (
        <div>
          <div className="text-sm font-medium mb-2">📝 Reviewer Comments</div>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
            {approval.reviewNote}
          </div>
        </div>
      )}
    </div>
  );
};
