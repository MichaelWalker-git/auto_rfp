'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ReviewDecisionCard } from './ReviewDecisionCard';
import type { UniversalApprovalItem } from '@auto-rfp/core';

interface ReviewHistoryListProps {
  reviews: UniversalApprovalItem[];
}

export const ReviewHistoryList = ({ reviews }: ReviewHistoryListProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (reviews.length === 0) return null;

  return (
    <div className="space-y-3">
      <Separator />

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="text-sm text-muted-foreground">
          View Review History ({reviews.length} previous review{reviews.length > 1 ? 's' : ''})
        </span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>

      {isExpanded && (
        <div className="space-y-4 pl-4 border-l-2 border-muted">
          {reviews.map((review) => (
            <div key={review.approvalId}>
              <ReviewDecisionCard approval={review} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
