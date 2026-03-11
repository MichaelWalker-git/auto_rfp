'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, XCircle, Loader2, ListChecks, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useBulkReview } from '../hooks/useBulkReview';
import type { DocumentApprovalItem } from '@auto-rfp/core';

interface BulkReviewPanelProps {
  pendingApprovals: DocumentApprovalItem[];
  currentUserId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  onSuccess?: () => void;
}

export const BulkReviewPanel = ({
  pendingApprovals,
  currentUserId,
  orgId,
  projectId,
  opportunityId,
  onSuccess,
}: BulkReviewPanelProps) => {
  // Filter to only approvals assigned to the current user
  const myPendingApprovals = pendingApprovals.filter(
    (a) => a.reviewerId === currentUserId && a.status === 'PENDING',
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(myPendingApprovals.map((a) => a.approvalId)),
  );
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState('');
  const { bulkReview, isLoading } = useBulkReview();
  const { toast } = useToast();

  if (myPendingApprovals.length < 2) return null; // Only show for 2+ pending

  const toggleSelection = (approvalId: string) => {
    const next = new Set(selectedIds);
    if (next.has(approvalId)) next.delete(approvalId);
    else next.add(approvalId);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === myPendingApprovals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(myPendingApprovals.map((a) => a.approvalId)));
    }
  };

  const selectedApprovals = myPendingApprovals.filter((a) => selectedIds.has(a.approvalId));

  const handleBulkApprove = async () => {
    if (selectedApprovals.length === 0) return;

    const result = await bulkReview({
      orgId,
      projectId,
      opportunityId,
      reviews: selectedApprovals.map((a) => ({
        documentId: a.documentId,
        approvalId: a.approvalId,
        decision: 'APPROVED' as const,
      })),
    });

    if (result) {
      toast({
        title: `✅ ${result.totalApproved} Document(s) Approved`,
        description: result.totalFailed > 0
          ? `${result.totalFailed} failed — check individual documents`
          : 'All selected documents have been approved.',
      });
      onSuccess?.();
    }
  };

  const handleBulkReject = async () => {
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectReasonError('Rejection reason is required');
      return;
    }
    setRejectReasonError('');

    const result = await bulkReview({
      orgId,
      projectId,
      opportunityId,
      reviews: selectedApprovals.map((a) => ({
        documentId: a.documentId,
        approvalId: a.approvalId,
        decision: 'REJECTED' as const,
        reviewNote: trimmed,
      })),
    });

    if (result) {
      toast({
        title: `❌ ${result.totalRejected} Document(s) Rejected`,
        description: 'The requester has been notified with your rejection reason.',
      });
      setShowRejectDialog(false);
      setRejectReason('');
      onSuccess?.();
    }
  };

  return (
    <>
      <Card className="border-indigo-200 bg-indigo-50/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-indigo-600" />
            Bulk Review
            <Badge variant="outline" className="border-indigo-300 text-indigo-700 text-xs">
              {myPendingApprovals.length} pending
            </Badge>
          </CardTitle>
          <CardDescription>
            You have {myPendingApprovals.length} documents pending your review. Select documents and
            approve or reject them in bulk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Select all toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.size === myPendingApprovals.length}
              onCheckedChange={toggleAll}
            />
            <span className="text-xs text-muted-foreground">
              Select all ({selectedIds.size}/{myPendingApprovals.length})
            </span>
          </div>

          {/* Document list */}
          <div className="space-y-1.5">
            {myPendingApprovals.map((a) => (
              <div
                key={a.approvalId}
                className="flex items-center gap-2 p-2 rounded border bg-white"
              >
                <Checkbox
                  checked={selectedIds.has(a.approvalId)}
                  onCheckedChange={() => toggleSelection(a.approvalId)}
                />
                <span className="text-sm flex-1 truncate">
                  {a.documentName ?? a.documentId}
                </span>
                <Badge variant="outline" className="text-xs">
                  Pending
                </Badge>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleBulkApprove}
              disabled={isLoading || selectedIds.size === 0}
              className="gap-2 flex-1 bg-emerald-600 hover:bg-emerald-700"
              size="sm"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Approve Selected ({selectedIds.size})
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowRejectDialog(true)}
              disabled={isLoading || selectedIds.size === 0}
              className="gap-2 flex-1"
              size="sm"
            >
              <XCircle className="h-4 w-4" />
              Reject Selected ({selectedIds.size})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk rejection dialog */}
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
              Reject {selectedIds.size} Document(s)
            </DialogTitle>
            <DialogDescription>
              This rejection reason will be applied to all {selectedIds.size} selected document(s).
              Each requester will be notified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Textarea
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                if (e.target.value.trim()) setRejectReasonError('');
              }}
              placeholder="Describe what needs to be changed…"
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
              onClick={handleBulkReject}
              disabled={isLoading || !rejectReason.trim()}
              className="gap-2"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Reject All Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
