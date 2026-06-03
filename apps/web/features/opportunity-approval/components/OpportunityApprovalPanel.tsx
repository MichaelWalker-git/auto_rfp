'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Loader2, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/AuthProvider';
import {
  useOpportunityApproval,
  useSubmitUniversalReview,
} from '@/lib/hooks/use-universal-approval';
import type { SubmitUniversalReview } from '@auto-rfp/core';

interface OpportunityApprovalPanelProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  onResolved?: () => void;
}

export const OpportunityApprovalPanel = ({
  orgId,
  projectId,
  opportunityId,
  onResolved,
}: OpportunityApprovalPanelProps) => {
  const [reviewNote, setReviewNote] = useState('');
  const { activeApproval, refresh } = useOpportunityApproval(orgId, projectId, opportunityId);
  const { submitReview, isLoading } = useSubmitUniversalReview();
  const { toast } = useToast();
  const { userSub } = useAuth();

  // Only show to the assigned reviewer of the active PENDING request
  if (!activeApproval || activeApproval.reviewerId !== userSub) return null;

  const entitySK = `${orgId}#${projectId}#${opportunityId}`;

  const handleDecision = async (decision: 'APPROVED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !reviewNote.trim()) {
      toast({
        title: 'Reason Required',
        description: 'Please provide a reason when rejecting.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const common = {
        orgId,
        projectId,
        entityType: 'opportunity' as const,
        entityId: opportunityId,
        entitySK,
        approvalId: activeApproval.approvalId,
      };
      const payload: SubmitUniversalReview =
        decision === 'APPROVED'
          ? { ...common, decision: 'APPROVED', reviewNote: reviewNote.trim() || undefined }
          : { ...common, decision: 'REJECTED', reviewNote: reviewNote.trim() };
      await submitReview(payload);

      toast({
        title: decision === 'APPROVED' ? '✅ Opportunity Approved' : '❌ Opportunity Rejected',
        description: 'Your review has been submitted.',
      });
      setReviewNote('');
      refresh();
      onResolved?.();
    } catch {
      toast({
        title: 'Submission Failed',
        description: 'Could not submit your review. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="text-base">Your Review Is Requested</CardTitle>
        <CardDescription>
          {activeApproval.requestedByName ?? 'A team member'} asked you to review this opportunity.
          Approve it or reject with a reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="opp-review-note">Comment {/* required for rejection */}</Label>
          <Textarea
            id="opp-review-note"
            placeholder="Add a comment (required when rejecting)…"
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={3}
            disabled={isLoading}
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => handleDecision('APPROVED')}
            disabled={isLoading}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleDecision('REJECTED')}
            disabled={isLoading}
            className="gap-2"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
