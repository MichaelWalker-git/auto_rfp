'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useUsersList } from '@/lib/hooks/use-user';
import { useRequestApproval } from '../hooks/useRequestApproval';
import { useAuth } from '@/components/AuthProvider';

interface RequestApprovalButtonProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  documentName?: string;
  disabled?: boolean;
  onSuccess?: () => void;
}

export const RequestApprovalButton = ({
  orgId,
  projectId,
  opportunityId,
  documentId,
  documentName,
  disabled,
  onSuccess,
}: RequestApprovalButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const { requestApproval, isLoading } = useRequestApproval();
  const { toast } = useToast();
  const { userSub } = useAuth();

  const { data: usersData, isLoading: isLoadingUsers } = useUsersList(orgId, { status: 'ACTIVE', limit: 200 });

  // Filter out the current user — cannot request approval from yourself
  const eligibleReviewers = (usersData?.items ?? []).filter(
    (u: { userId: string; email: string; displayName?: string; firstName?: string }) => u.userId !== userSub,
  );

  const handleSubmit = async () => {
    if (!reviewerId) return;

    const result = await requestApproval({
      orgId,
      projectId,
      opportunityId,
      documentId,
      reviewerId,
    });

    if (result) {
      toast({
        title: '📋 Approval Requested',
        description: `Review request sent. The reviewer will be notified and a Linear ticket has been created.`,
      });
      setShowDialog(false);
      setReviewerId('');
      
      // Force a small delay to ensure backend has processed the request
      setTimeout(() => {
        onSuccess?.();
      }, 500);
    } else {
      toast({
        title: 'Request Failed',
        description: 'Could not send approval request. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={disabled || isLoading}
        onClick={() => setShowDialog(true)}
        title={disabled ? "Approval already requested" : "Request approval for this document"}
      >
        <ClipboardCheck className="h-4 w-4" />
        {disabled ? 'Approval Requested' : 'Request Approval'}
      </Button>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) setReviewerId('');
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Request Document Approval
            </DialogTitle>
            <DialogDescription>
              Select a team member to review{documentName ? ` "${documentName}"` : ' this document'}.
              They will receive an in-app notification and a Linear ticket will be created.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-2">
            <Label>Reviewer</Label>
            {isLoadingUsers ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={reviewerId} onValueChange={setReviewerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reviewer…" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleReviewers.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No other team members available
                    </SelectItem>
                  ) : (
                    eligibleReviewers.map((u) => (
                      <SelectItem key={u.userId} value={u.userId}>
                        {u.displayName ?? u.firstName ?? u.email}
                        {u.email && (u.displayName ?? u.firstName) ? (
                          <span className="text-muted-foreground ml-1 text-xs">({u.email})</span>
                        ) : null}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!reviewerId || isLoading}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <ClipboardCheck className="h-4 w-4" />
                  Send Request
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
