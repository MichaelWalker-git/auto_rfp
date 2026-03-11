'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useResubmitForReview } from '../hooks/useResubmitForReview';
import type { DocumentApprovalItem } from '@auto-rfp/core';

interface ResubmitForReviewButtonProps {
  approval: DocumentApprovalItem;
  currentUserId: string;
  onSuccess?: () => void;
}

export const ResubmitForReviewButton = ({
  approval,
  currentUserId,
  onSuccess,
}: ResubmitForReviewButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const { resubmit, isLoading } = useResubmitForReview();
  const { toast } = useToast();

  // Only the original requester can re-submit, and only for REJECTED approvals
  if (approval.requestedBy !== currentUserId) return null;
  if (approval.status !== 'REJECTED') return null;

  const handleResubmit = async () => {
    const result = await resubmit({
      orgId: approval.orgId,
      projectId: approval.projectId,
      opportunityId: approval.opportunityId,
      documentId: approval.documentId,
      approvalId: approval.approvalId,
      revisionNote: revisionNote.trim() || undefined,
    });

    if (result) {
      toast({
        title: '🔄 Re-Submitted for Review',
        description: `The document has been re-submitted to ${approval.reviewerName ?? 'the reviewer'} for review.`,
      });
      setShowDialog(false);
      setRevisionNote('');
      onSuccess?.();
    } else {
      toast({
        title: 'Re-Submit Failed',
        description: 'Could not re-submit for review. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowDialog(true)}
        className="gap-2"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Re-Submit for Review
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Re-Submit for Review
            </DialogTitle>
            <DialogDescription>
              Re-submit{' '}
              <span className="font-medium text-foreground">
                {approval.documentName ?? 'this document'}
              </span>{' '}
              to {approval.reviewerName ?? 'the reviewer'} for another review.
              {approval.reviewNote && (
                <span className="block mt-2 text-amber-700 bg-amber-50 p-2 rounded text-xs">
                  <strong>Previous rejection reason:</strong> {approval.reviewNote}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>
              Revision Note
              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
            </Label>
            <Textarea
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder="Describe what you changed to address the reviewer's feedback…"
              rows={3}
              disabled={isLoading}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleResubmit} disabled={isLoading} className="gap-2">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Re-Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
