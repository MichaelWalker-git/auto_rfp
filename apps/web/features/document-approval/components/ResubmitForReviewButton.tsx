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
import { RefreshCw, Loader2, XCircle } from 'lucide-react';
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
        variant="default"
        size="sm"
        onClick={() => setShowDialog(true)}
        className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
      >
        <RefreshCw className="h-4 w-4" />
        Re-Submit for Review
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <RefreshCw className="h-5 w-5" />
              Re-Submit for Review
            </DialogTitle>
            <DialogDescription>
              Re-submit{' '}
              <span className="font-medium text-foreground">
                {approval.documentName ?? 'this document'}
              </span>{' '}
              to {approval.reviewerName ?? 'the reviewer'} for another review.
            </DialogDescription>
          </DialogHeader>

          {/* Previous rejection reason */}
          {approval.reviewNote && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-semibold text-red-800">Previous Rejection Reason</span>
              </div>
              <p className="text-sm text-red-700">{approval.reviewNote}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="revision-note">
              Revision Note
              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
            </Label>
            <Textarea
              id="revision-note"
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder="Describe what you changed to address the reviewer's feedback…"
              rows={3}
              disabled={isLoading}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This note will help the reviewer understand what changes you made.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button 
              onClick={handleResubmit} 
              disabled={isLoading} 
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Re-Submitting…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Re-Submit for Review
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
