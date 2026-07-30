'use client';

import { Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOpportunityApproval } from '@/lib/hooks/use-universal-approval';

interface OpportunityCardApprovalBadgeProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

export const OpportunityCardApprovalBadge = ({
  orgId,
  projectId,
  opportunityId,
}: OpportunityCardApprovalBadgeProps) => {
  const { approvals, isLoading } = useOpportunityApproval(orgId, projectId, opportunityId);

  if (isLoading) return null;

  const completedReviews = approvals.filter(
    (a) => a.status === 'APPROVED' || a.status === 'REJECTED'
  );

  if (completedReviews.length === 0) return null;

  const latestReview = completedReviews[0];
  const isApproved = latestReview.status === 'APPROVED';
  const reviewDate = latestReview.reviewedAt ? new Date(latestReview.reviewedAt) : null;

  const tooltipText = [
    isApproved ? 'Approved' : 'Rejected',
    latestReview.reviewerName ? `by ${latestReview.reviewerName}` : '',
    reviewDate ? `on ${format(reviewDate, 'MMM d, yyyy')}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${
            isApproved
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
          }`}
        >
          {isApproved ? (
            <Check className="h-3 w-3" />
          ) : (
            <X className="h-3 w-3" />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
};
