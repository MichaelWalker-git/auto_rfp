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
import { Send, Loader2, AlertTriangle, Copy, Mail, Download, ExternalLink } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
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

type EmailDraft = {
  subject: string;
  body: string;
  attachments: Array<{ name: string; url: string; documentId: string }>;
};

export const SubmitProposalButton = ({ orgId, projectId, oppId, onSuccess }: SubmitProposalButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
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
    // Strip empty optional strings so Zod .url() validation doesn't fail on ""
    if (!values.portalUrl) values.portalUrl = undefined;
    if (!values.submissionReference) values.submissionReference = undefined;
    if (!values.submissionNotes) values.submissionNotes = undefined;
    const result = await submit(values as SubmitProposal) as (Record<string, unknown>) | null;
    if (result) {
      toast({
        title: '📤 Proposal Submitted',
        description: 'Your proposal has been successfully submitted to the agency.',
      });
      reset();
      setShowDialog(false);
      // Show email draft if available
      if (result.emailDraft) {
        setEmailDraft(result.emailDraft as EmailDraft);
      }
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

          <form onSubmit={handleSubmit(onSubmit, (formErrors) => {
            const firstError = Object.values(formErrors)[0];
            toast({ title: 'Validation error', description: firstError?.message ?? 'Please check the form', variant: 'destructive' });
          })} className="space-y-4">
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

      {/* Email Draft Dialog — shown after successful submission */}
      <Dialog open={!!emailDraft} onOpenChange={(open) => { if (!open) setEmailDraft(null); }}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Submission Email Draft
            </DialogTitle>
            <DialogDescription>
              Copy this email and attach the documents to send to the contracting officer.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {/* Subject */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <div className="flex items-center gap-2">
                <Input value={emailDraft?.subject ?? ''} readOnly className="text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 h-9 w-9"
                  onClick={() => {
                    navigator.clipboard.writeText(emailDraft?.subject ?? '');
                    toast({ title: 'Subject copied' });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Body */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Email Body</Label>
              <Textarea value={emailDraft?.body ?? ''} readOnly rows={10} className="text-sm font-mono" />
            </div>

            {/* Attachments */}
            {emailDraft?.attachments && emailDraft.attachments.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Attachments ({emailDraft.attachments.length})
                </Label>
                <div className="space-y-1">
                  {emailDraft.attachments.map((att) => (
                    <a
                      key={att.documentId}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border p-2 hover:bg-muted/50 transition-colors text-sm"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{att.name}</span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const text = `Subject: ${emailDraft?.subject ?? ''}\n\n${emailDraft?.body ?? ''}`;
                navigator.clipboard.writeText(text);
                toast({ title: 'Email copied to clipboard' });
              }}
              className="gap-2"
            >
              <Copy className="h-4 w-4" />
              Copy All
            </Button>
            <Button
              onClick={() => {
                const mailto = `mailto:?subject=${encodeURIComponent(emailDraft?.subject ?? '')}&body=${encodeURIComponent(emailDraft?.body ?? '')}`;
                window.open(mailto, '_blank');
              }}
              className="gap-2"
            >
              <Mail className="h-4 w-4" />
              Open in Email Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
