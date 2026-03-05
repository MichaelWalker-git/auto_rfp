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
import { Loader2, Undo2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useWithdrawSubmission } from '../hooks/useWithdrawSubmission';

interface WithdrawSubmissionButtonProps {
  orgId: string;
  projectId: string;
  oppId: string;
  submissionId: string;
  onSuccess?: () => void;
}

export const WithdrawSubmissionButton = ({
  orgId,
  projectId,
  oppId,
  submissionId,
  onSuccess,
}: WithdrawSubmissionButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [reason, setReason] = useState('');
  const { withdraw, isLoading } = useWithdrawSubmission();
  const { toast } = useToast();

  const handleWithdraw = async () => {
    const ok = await withdraw({
      orgId,
      projectId,
      oppId,
      submissionId,
      withdrawalReason: reason || undefined,
    });
    if (ok) {
      toast({ title: 'Submission Withdrawn', description: 'The proposal submission has been withdrawn.' });
      setShowDialog(false);
      setReason('');
      onSuccess?.();
    } else {
      toast({
        title: 'Withdrawal Failed',
        variant: 'destructive',
        description: 'Could not withdraw the submission.',
      });
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive shrink-0"
        onClick={() => setShowDialog(true)}
      >
        <Undo2 className="h-3 w-3" />
        Withdraw
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Withdraw Submission</DialogTitle>
            <DialogDescription>
              Mark this submission as withdrawn. The opportunity stage will not change automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>
              Reason{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Solicitation cancelled, team capacity, scope change..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleWithdraw}
              disabled={isLoading}
              className="gap-2"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
