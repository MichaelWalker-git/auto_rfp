'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, XCircle, Loader2, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useSubmitReview } from '../hooks/useSubmitReview';
import type { DocumentApprovalItem } from '@auto-rfp/core';

interface ReviewDecisionPanelProps {
  approval: DocumentApprovalItem;
  currentUserId: string;
  onSuccess?: () => void;
}

export const ReviewDecisionPanel = ({
  approval,
  currentUserId,
  onSuccess,
}: ReviewDecisionPanelProps) => {
  const [approveNote, setApproveNote] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState('');
  const { submitReview, isLoading } = useSubmitReview();
  const { toast } = useToast();

  // Only the assigned reviewer can see this panel
  if (approval.reviewerId !== currentUserId) return null;
  if (approval.status !== 'PENDING') return null;

  const handleApprove = async () => {
    const result = await submitReview({
      orgId: approval.orgId,
      projectId: approval.projectId,
      opportunityId: approval.opportunityId,
      documentId: approval.documentId,
      approvalId: approval.approvalId,
      decision: 'APPROVED',
      reviewNote: approveNote.trim() || undefined,
    });

    if (result) {
      toast({
        title: '✅ Document Approved',
        description: 'The document has been approved and marked as fully signed. The requester has been notified.',
      });
      onSuccess?.();
    } else {
      toast({
        title: 'Approval Failed',
        description: 'Could not submit your approval. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleRejectSubmit = async () => {
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectReasonError('Rejection reason is required');
      return;
    }
    setRejectReasonError('');

    const result = await submitReview({
      orgId: approval.orgId,
      projectId: approval.projectId,
      opportunityId: approval.opportunityId,
      documentId: approval.documentId,
      approvalId: approval.approvalId,
      decision: 'REJECTED',
      reviewNote: trimmed,
    });

    if (result) {
      toast({
        title: '❌ Document Rejected',
        description: 'The document has been rejected. The requester has been notified with your reason.',
      });
      setShowRejectDialog(false);
      setRejectReason('');
      onSuccess?.();
    } else {
      toast({
        title: 'Rejection Failed',
        description: 'Could not submit your rejection. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Card className="border-amber-200 bg-amber-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-amber-600" />
            Your Review is Required
            <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
              Pending
            </Badge>
          </CardTitle>
          <CardDescription>
            {approval.requestedByName ?? 'A team member'} has requested your approval for this document.
            {approval.linearTicketUrl && (
              <a
                href={approval.linearTicketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-indigo-600 hover:underline text-xs"
              >
                View Linear ticket ↗
              </a>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>
              Approval Note
              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
            </Label>
            <Textarea
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              placeholder="Add a note about your approval (e.g. looks good, approved as-is)…"
              rows={2}
              disabled={isLoading}
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleApprove}
              disabled={isLoading}
              className="gap-2 flex-1 bg-emerald-600 hover:bg-emerald-700"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Approve
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowRejectDialog(true)}
              disabled={isLoading}
              className="gap-2 flex-1"
            >
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Rejection dialog — requires a reason */}
      <Dialog
        open={showRejectDialog}
        onOpenChange={(open) => {
          setShowRejectDialog(open);
          if (!open) {
            setRejectReason('');
            setRejectReasonError('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Reject Document
            </DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting{' '}
              <span className="font-medium text-foreground">
                {approval.documentName ?? 'this document'}
              </span>
              . The requester will be notified and the Linear ticket will be reassigned to them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-1">
            <Label htmlFor="reject-reason">
              Rejection Reason
              <span className="text-destructive ml-1">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                if (e.target.value.trim()) setRejectReasonError('');
              }}
              placeholder="Describe what needs to be changed or why this document cannot be approved…"
              rows={4}
              disabled={isLoading}
              className={rejectReasonError ? 'border-destructive' : ''}
            />
            {rejectReasonError && (
              <p className="text-xs text-destructive">{rejectReasonError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRejectDialog(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={isLoading || !rejectReason.trim()}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Rejecting…
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" />
                  Confirm Rejection
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
