'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  ClipboardCheck, 
  Clock,
  Calendar,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { useSubmitReview } from '../hooks/useSubmitReview';
import { ResubmitForReviewButton } from './ResubmitForReviewButton';
import type { DocumentApprovalItem } from '@auto-rfp/core';

/**
 * Helper to resolve a human-readable display name from a DocumentApprovalItem.
 * Returns the stored name only when it looks like a real name (not a raw UUID/ID).
 */
const resolveDisplayName = (
  name: string | undefined,
  fallback = 'Unknown',
): string => {
  if (!name) return fallback;
  // Treat anything that looks like a UUID or long hyphenated ID as "not a name"
  if (name.length > 50 || /^[0-9a-f]{8}-/.test(name)) return fallback;
  return name;
};

interface ReviewSidebarPanelProps {
  approval: DocumentApprovalItem | null;
  approvals: DocumentApprovalItem[];
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ReviewSidebarPanel = ({
  approval,
  approvals,
  currentUserId,
  isOpen,
  onClose,
  onSuccess,
}: ReviewSidebarPanelProps) => {
  const [reviewNote, setReviewNote] = useState('');
  const { submitReview, isLoading } = useSubmitReview();
  const { toast } = useToast();

  if (!isOpen) return null;

  const isReviewer = approval && approval.reviewerId === currentUserId;
  const isPending = approval && approval.status === 'PENDING';
  const canReview = isReviewer && isPending;
  
  // Check if current user can resubmit a rejected document
  // Only show if the most recent approval is rejected and there's no newer approval
  const rejectedApproval = approvals.length > 0 && approvals[0].status === 'REJECTED' && approvals[0].requestedBy === currentUserId ? approvals[0] : null;
  const canResubmit = rejectedApproval && !approval; // No active approval means we can resubmit

  const handleApprove = async () => {
    if (!approval) return;
    
    const result = await submitReview({
      orgId: approval.orgId,
      projectId: approval.projectId,
      opportunityId: approval.opportunityId,
      documentId: approval.documentId,
      approvalId: approval.approvalId,
      decision: 'APPROVED',
      reviewNote: reviewNote.trim() || undefined,
    });

    if (result) {
      toast({
        title: '✅ Document Approved',
        description: 'The document has been approved and marked as fully signed. The requester has been notified.',
      });
      setReviewNote('');
      onSuccess?.();
    } else {
      toast({
        title: 'Approval Failed',
        description: 'Could not submit your approval. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleReject = async () => {
    if (!approval) return;
    
    const trimmed = reviewNote.trim();
    if (!trimmed) {
      toast({
        title: 'Rejection reason required',
        description: 'Please provide a reason for rejecting this document.',
        variant: 'destructive',
      });
      return;
    }

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
      setReviewNote('');
      onSuccess?.();
    } else {
      toast({
        title: 'Rejection Failed',
        description: 'Could not submit your rejection. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'PENDING':
        return <Clock className="h-4 w-4 text-amber-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Current Review Action */}
          {canReview && (
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
                  {(() => {
                    const requesterName = resolveDisplayName(approval.requestedByName);
                    if (requesterName !== 'Unknown') {
                      return `${requesterName} has requested your approval for this document.`;
                    }
                    return 'A team member has requested your approval for this document.';
                  })()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>
                    Note / Reason
                    <span className="text-muted-foreground font-normal ml-1">(required for rejection)</span>
                  </Label>
                  <Textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="Add approval note or rejection reason..."
                    rows={3}
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
                    onClick={handleReject}
                    disabled={isLoading || !reviewNote.trim()}
                    className="gap-2 flex-1"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resubmit for Review — shown to requester when document is rejected */}
          {canResubmit && rejectedApproval && (
            <Card className="border-red-200 bg-red-50/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  Document Rejected
                  <Badge variant="destructive" className="text-xs">
                    Action Required
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {resolveDisplayName(rejectedApproval.reviewerName, 'The reviewer')} rejected this document. Please address the feedback and resubmit.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Rejection reason */}
                {rejectedApproval.reviewNote && (
                  <div className="bg-red-100 border border-red-200 rounded-lg p-3">
                    <p className="font-medium text-xs mb-1 text-red-800">Rejection Reason:</p>
                    <p className="text-sm text-red-800">{rejectedApproval.reviewNote}</p>
                  </div>
                )}
                
                <div className="flex justify-start">
                  <ResubmitForReviewButton
                    approval={rejectedApproval}
                    currentUserId={currentUserId}
                    onSuccess={onSuccess}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Current Approval Status - Show for any approval */}
          {approvals.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {approval ? 'Current Status' : 'Latest Status'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Show current approval or most recent approval */}
                {(() => {
                  const displayApproval = approval || approvals[0];
                  if (!displayApproval) return null;

                  const requesterDisplayName = resolveDisplayName(displayApproval.requestedByName);
                  const reviewerDisplayName = resolveDisplayName(displayApproval.reviewerName);
                  
                  return (
                    <>
                      <div className="flex items-center gap-3">
                        {getStatusIcon(displayApproval.status)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge 
                              variant={displayApproval.status === 'APPROVED' ? 'default' : 
                                       displayApproval.status === 'REJECTED' ? 'destructive' : 'secondary'}
                              className="text-xs"
                            >
                              {displayApproval.status.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      {/* Participants */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-xs">
                              {requesterDisplayName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {requesterDisplayName}
                            {displayApproval.requestedBy === currentUserId && <span className="text-muted-foreground ml-1">(You)</span>}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-xs">
                              {reviewerDisplayName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {reviewerDisplayName}
                            {displayApproval.reviewerId === currentUserId && <span className="text-muted-foreground ml-1">(You)</span>}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          Requested {formatDistanceToNow(new Date(displayApproval.requestedAt), { addSuffix: true })}
                          {displayApproval.reviewedAt && (
                            <span>• Reviewed {formatDistanceToNow(new Date(displayApproval.reviewedAt), { addSuffix: true })}</span>
                          )}
                        </div>
                      </div>

                      {/* Review note */}
                      {displayApproval.reviewNote && (
                        <div className={`p-2 rounded text-sm ${
                          displayApproval.status === 'APPROVED' 
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                            : 'bg-red-50 text-red-800 border border-red-200'
                        }`}>
                          <p className="font-medium text-xs mb-1">
                            {displayApproval.status === 'APPROVED' ? 'Approval Note:' : 'Rejection Reason:'}
                          </p>
                          <p>{displayApproval.reviewNote}</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Approval History */}
          {approvals.length > 1 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Approval History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {approvals.slice(1).map((pastApproval) => (
                    <div key={pastApproval.approvalId} className="flex items-start gap-3 p-2 rounded-lg bg-muted/30">
                      {getStatusIcon(pastApproval.status)}
                      <div className="flex-1 min-w-0 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {pastApproval.status.replace('_', ' ')}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(pastApproval.requestedAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {resolveDisplayName(pastApproval.requestedByName)} → {resolveDisplayName(pastApproval.reviewerName)}
                        </p>
                        {pastApproval.reviewNote && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            &ldquo;{pastApproval.reviewNote}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No approvals state */}
          {approvals.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center">
                <ClipboardCheck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No approval requests for this document yet.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
