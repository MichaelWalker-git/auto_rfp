'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SubmitProposalSchema } from '@auto-rfp/core';
import type { SubmitProposal } from '@auto-rfp/core';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Send, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useSubmitProposal } from '../hooks/useSubmitProposal';
import { useSubmissionReadiness } from '../hooks/useSubmissionReadiness';
import { useIgnoredChecks } from '../hooks/useIgnoredChecks';

interface SubmitProposalButtonProps {
  orgId: string;
  projectId: string;
  oppId: string;
  onSuccess?: () => void;
}

type FormValues = z.input<typeof SubmitProposalSchema>;

const SUBMISSION_METHODS = [
  { value: 'PORTAL',        label: 'Agency Portal (SAM.gov, beta.SAM.gov, etc.)' },
  { value: 'EMAIL',         label: 'Email to Contracting Officer' },
  { value: 'MANUAL',        label: 'Manual / Other System' },
  { value: 'HAND_DELIVERY', label: 'Hand Delivery' },
  { value: 'OTHER',         label: 'Other' },
] as const;

export const SubmitProposalButton = ({ orgId, projectId, oppId, onSuccess }: SubmitProposalButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const { submit, isLoading } = useSubmitProposal();
  const { checks, blockingFails: rawBlockingFails, warningFails: rawWarningFails, isLoading: isCheckingReadiness } = useSubmissionReadiness(orgId, projectId, oppId);
  const { ignoredIds } = useIgnoredChecks(oppId);
  const { toast } = useToast();

  // Recompute blocking/warning excluding ignored checks
  const blockingFails = checks.filter((c) => !c.passed && c.blocking && !ignoredIds.has(c.id)).length;
  const warningFails = checks.filter((c) => !c.passed && !c.blocking && !ignoredIds.has(c.id)).length;
  const isReady = blockingFails === 0;

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(SubmitProposalSchema),
    defaultValues: {
      orgId,
      projectId,
      oppId,
      submissionMethod: 'PORTAL',
      forceSubmit: false,
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await submit(values as SubmitProposal);
    if (result) {
      toast({
        title: '📤 Proposal Submitted',
        description: 'Your proposal has been successfully submitted to the agency.',
      });
      reset();
      setShowDialog(false);
      onSuccess?.();
    } else {
      toast({
        title: 'Submission Failed',
        description: 'Could not submit. Check the readiness checklist.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        disabled={!isReady || isCheckingReadiness}
        className="gap-2"
        size="lg"
      >
        <Send className="h-4 w-4" />
        Submit Proposal
        {blockingFails > 0 && (
          <Badge variant="secondary" className="ml-1 text-xs">
            {blockingFails} issue{blockingFails !== 1 ? 's' : ''}
          </Badge>
        )}
      </Button>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) reset();
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Submit Proposal to Agency
            </DialogTitle>
            <DialogDescription>
              Record how and where you submitted this proposal. This marks the opportunity as Submitted.
            </DialogDescription>
          </DialogHeader>

          {warningFails > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {warningFails} non-blocking warning{warningFails !== 1 ? 's' : ''} — review the checklist before submitting.
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <input type="hidden" {...register('orgId')} />
            <input type="hidden" {...register('projectId')} />
            <input type="hidden" {...register('oppId')} />

            <div className="space-y-1.5">
              <Label>Submission Method</Label>
              <Select
                defaultValue="PORTAL"
                onValueChange={(v) => setValue('submissionMethod', v as SubmitProposal['submissionMethod'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBMISSION_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Confirmation / Tracking Number
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </Label>
              <Input
                {...register('submissionReference')}
                placeholder="e.g. SAM-2025-001234 or email thread ID"
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Portal URL
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </Label>
              <Input
                {...register('portalUrl')}
                type="url"
                placeholder="https://sam.gov/opp/..."
              />
              {errors.portalUrl && (
                <p className="text-xs text-destructive">{errors.portalUrl.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>
                Notes
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </Label>
              <Textarea
                {...register('submissionNotes')}
                placeholder="Any notes about this submission..."
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} className="gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Confirm Submission
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
