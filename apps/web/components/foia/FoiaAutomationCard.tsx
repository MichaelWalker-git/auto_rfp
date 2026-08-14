'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PermissionButton } from '@/components/ui/permission-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { FoiaAutomationBadge } from './FoiaAutomationBadge';
import { FoiaStateSummary } from './FoiaStateSummary';
import { FoiaSendControls } from './FoiaSendControls';
import { FoiaDocumentsList } from './FoiaDocumentsList';
import { FoiaResponseUpload } from './FoiaResponseUpload';
import { FoiaCustomDocumentsEditor } from './FoiaCustomDocumentsEditor';
import {
  useFoiaAutomation,
  useUpdateFoiaAutomation,
  useConfirmFoiaRecipient,
} from '@/lib/hooks/use-foia-automation';
import { useFOIARequests } from '@/lib/hooks/use-foia-requests';
import {
  type FoiaAutomationItem,
  type FoiaRecipientCandidate,
} from '@auto-rfp/core';
import { Loader2, Clock, Ban, ExternalLink } from 'lucide-react';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaAutomationCardProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  opportunityStatus?: string;
  onAutomationChange?: (automation: FoiaAutomationItem) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FoiaAutomationCard = ({
  orgId,
  projectId,
  opportunityId,
  opportunityStatus,
  onAutomationChange,
}: FoiaAutomationCardProps) => {
  const { toast } = useToast();
  const { automation, isLoading, refetch } = useFoiaAutomation(orgId, projectId, opportunityId);
  const { updateFoiaAutomation, isSaving: isUpdating } = useUpdateFoiaAutomation();
  const { confirmRecipient, isSaving: isConfirming } = useConfirmFoiaRecipient();
  const { foiaRequests, isLoading: isLoadingRequests, refetch: refetchRequests } = useFOIARequests(
    orgId,
    projectId,
    opportunityId
  );

  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isSnoozeOpen, setIsSnoozeOpen] = useState(false);
  const [snoozeDays, setSnoozeDays] = useState<string>('7');

  const handleCancel = async () => {
    try {
      const updated = await updateFoiaAutomation({
        orgId,
        projectId,
        oppId: opportunityId,
        cancel: true,
      });
      await refetch();
      onAutomationChange?.(updated);
      setIsCancelDialogOpen(false);
      toast({ title: 'FOIA automation cancelled', description: 'This opportunity will no longer be automated.' });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to cancel automation',
        variant: 'destructive',
      });
    }
  };

  const handleMarkManualCompleted = async () => {
    try {
      const updated = await updateFoiaAutomation({
        orgId,
        projectId,
        oppId: opportunityId,
        markManualCompleted: true,
      });
      await refetch();
      onAutomationChange?.(updated);
      toast({ title: 'Marked as filed manually', description: 'The FOIA request is now recorded as completed.' });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to mark as completed',
        variant: 'destructive',
      });
    }
  };

  const handleSnooze = async () => {
    const days = parseInt(snoozeDays, 10);
    if (!days || days < 1 || days > 365) {
      toast({ title: 'Invalid snooze duration', description: 'Enter a number between 1 and 365 days.', variant: 'destructive' });
      return;
    }

    try {
      const scheduledSendAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const updated = await updateFoiaAutomation({
        orgId,
        projectId,
        oppId: opportunityId,
        scheduledSendAt,
      });
      await refetch();
      onAutomationChange?.(updated);
      setIsSnoozeOpen(false);
      toast({ title: 'FOIA automation snoozed', description: `Rescheduled ${days} days from now.` });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to snooze automation',
        variant: 'destructive',
      });
    }
  };

  const handleConfirmCandidate = async (candidate: FoiaRecipientCandidate) => {
    try {
      const updated = await confirmRecipient({
        orgId,
        projectId,
        oppId: opportunityId,
        foiaEmail: candidate.email,
        foiaAddress: '',
        saveToDirectory: true,
      });
      await refetch();
      onAutomationChange?.(updated);
      toast({ title: 'Recipient confirmed', description: `${candidate.email} will be used for this FOIA request.` });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to confirm recipient',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!automation || automation.state === 'NOT_APPLICABLE') {
    return null;
  }

  const scheduledDate = automation.scheduledSendAt
    ? new Date(automation.scheduledSendAt)
    : null;

  const foiaRequest = automation.foiaRequestId
    ? foiaRequests.find((r) => r.foiaId === automation.foiaRequestId) ?? null
    : null;

  const handleSendComplete = async () => {
    await refetch();
    await refetchRequests();
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Automatic FOIA Request
            </CardTitle>
            <FoiaAutomationBadge state={automation.state} />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* State summary */}
          <FoiaStateSummary automation={automation} scheduledDate={scheduledDate} />

          {/* BLOCKED — the reason itself is rendered by FoiaStateSummary above;
              this block adds only the actions that resolve it. */}
          {automation.state === 'BLOCKED' && automation.blockedReason && (
            <div className="space-y-3">
              {/* NEEDS_CONFIRMATION — show candidate list */}
              {automation.blockedReason === 'NEEDS_CONFIRMATION' &&
                automation.recipientCandidates &&
                automation.recipientCandidates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Found in solicitation documents:</p>
                    {/*
                      Named as scraped, not endorsed. These are whatever email
                      addresses appeared in the PDF — usually the contracting
                      officer, who is not the FOIA officer.
                    */}
                    <p className="text-xs text-muted-foreground">
                      These are addresses found in the solicitation, which are usually bid
                      contacts rather than the agency&apos;s FOIA office. Check the agency&apos;s
                      published FOIA contact before using one.
                    </p>
                    <div className="space-y-2">
                      {automation.recipientCandidates.map((candidate, idx) => (
                        <div
                          key={idx}
                          className="border rounded-md p-3 space-y-2 hover:border-indigo-300 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1 flex-1 min-w-0">
                              <p className="text-sm font-medium break-all">{candidate.email}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {candidate.context}
                              </p>
                              {candidate.sourceFileName && (
                                <p className="text-xs text-muted-foreground">
                                  Source: {candidate.sourceFileName}
                                </p>
                              )}
                            </div>
                            <PermissionButton
                              requiredPermission="project:edit"
                              size="sm"
                              variant="outline"
                              onClick={() => handleConfirmCandidate(candidate)}
                              disabled={isConfirming}
                            >
                              {isConfirming ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                'Use this'
                              )}
                            </PermissionButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/*
                Manual entry — offered for NEEDS_CONFIRMATION as well as
                NEEDS_RECIPIENT.

                Candidates are scraped from the solicitation, so they are the
                addresses the agency published for *bids*, not for records
                requests. On a real BIA opportunity both candidates were the
                contracting officer and contract specialist, while the address
                FOIA.gov publishes for that component is foia@bia.gov — which
                appears nowhere in the PDF. Gating this form to NEEDS_RECIPIENT
                meant the only options were two wrong addresses, with no way to
                enter the right one short of calling the API directly.
              */}
              {(automation.blockedReason === 'NEEDS_RECIPIENT' ||
                automation.blockedReason === 'NEEDS_CONFIRMATION') && (
                <ManualRecipientForm
                  orgId={orgId}
                  projectId={projectId}
                  oppId={opportunityId}
                  onConfirm={async () => {
                    await refetch();
                    toast({ title: 'Recipient saved', description: 'The automation can now proceed.' });
                  }}
                />
              )}

              {/* AGENCY_REQUIRES_PORTAL */}
              {automation.blockedReason === 'AGENCY_REQUIRES_PORTAL' && automation.resolvedRecipientEmail && (
                <div className="text-sm space-y-2">
                  <p className="text-muted-foreground">
                    This agency does not accept email submissions. Use their web portal instead.
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={automation.resolvedRecipientEmail}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1"
                    >
                      Open Portal
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              )}

              {/* MISSING_LETTER_FIELDS */}
              {automation.blockedReason === 'MISSING_LETTER_FIELDS' && automation.missingFields && (
                <div className="text-sm space-y-2">
                  <p className="text-muted-foreground">Missing required fields:</p>
                  <ul className="text-xs text-muted-foreground list-disc list-inside">
                    {automation.missingFields.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/*
            Additional document requests — offered at the approval step, the one
            moment a human is already reading the letter. Saving re-renders the
            persisted artifacts, so what is approved stays what is sent.
          */}
          {(automation.state === 'AWAITING_APPROVAL' || automation.state === 'FAILED') &&
            automation.foiaRequestId && (
              <div className="pt-2">
                <FoiaCustomDocumentsEditor
                  orgId={orgId}
                  projectId={projectId}
                  oppId={opportunityId}
                  customDocumentRequests={foiaRequest?.customDocumentRequests}
                  onSaved={async () => {
                    await refetch();
                    await refetchRequests();
                  }}
                />
              </div>
            )}

          {/* Send controls for AWAITING_APPROVAL and STALLED */}
          {(automation.state === 'AWAITING_APPROVAL' || automation.state === 'STALLED') && (
            <FoiaSendControls
              orgId={orgId}
              projectId={projectId}
              opportunityId={opportunityId}
              automation={automation}
              foiaRequest={foiaRequest}
              recipientEmail={automation.resolvedRecipientEmail ?? null}
              onSendComplete={handleSendComplete}
            />
          )}

          {/* Documents list */}
          {(automation.state === 'SENT' ||
            automation.state === 'AWAITING_APPROVAL' ||
            automation.state === 'STALLED' ||
            automation.state === 'BOUNCED') && (
            <div className="pt-4 border-t">
              <FoiaDocumentsList
                orgId={orgId}
                projectId={projectId}
                opportunityId={opportunityId}
                artifacts={automation.artifacts}
                responseDocuments={foiaRequest?.responseDocuments}
                isLoading={isLoadingRequests}
              />
            </div>
          )}

          {/* Response upload (disabled due to backend limitation) */}
          {automation.state === 'SENT' && automation.foiaRequestId && (
            <div className="pt-2">
              <FoiaResponseUpload
                orgId={orgId}
                projectId={projectId}
                opportunityId={opportunityId}
                foiaRequestId={automation.foiaRequestId}
                onUploadComplete={refetchRequests}
              />
            </div>
          )}

          {/* Action controls for non-send states */}
          {(automation.state === 'SCHEDULED' || automation.state === 'BLOCKED') && (
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <PermissionButton
                requiredPermission="project:edit"
                variant="outline"
                size="sm"
                onClick={() => setIsSnoozeOpen(true)}
                disabled={isUpdating}
              >
                <Clock className="h-3.5 w-3.5 mr-1" />
                Snooze
              </PermissionButton>

              <PermissionButton
                requiredPermission="project:edit"
                variant="outline"
                size="sm"
                onClick={() => setIsCancelDialogOpen(true)}
                disabled={isUpdating}
              >
                <Ban className="h-3.5 w-3.5 mr-1" />
                Cancel automation
              </PermissionButton>

              <PermissionButton
                requiredPermission="project:edit"
                variant="outline"
                size="sm"
                onClick={handleMarkManualCompleted}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  'Mark as filed manually'
                )}
              </PermissionButton>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Snooze dialog */}
      <AlertDialog open={isSnoozeOpen} onOpenChange={setIsSnoozeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Snooze FOIA automation</AlertDialogTitle>
            <AlertDialogDescription>
              Reschedule the send date by a specified number of days from now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="snooze-days">Days to snooze</Label>
            <Input
              id="snooze-days"
              type="number"
              min="1"
              max="365"
              value={snoozeDays}
              onChange={(e) => setSnoozeDays(e.target.value)}
              placeholder="7"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSnooze}>Snooze</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel dialog */}
      <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel FOIA automation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the automatic FOIA request for this opportunity. You can still file
              the request manually later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep automation</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive hover:bg-destructive/90">
              Cancel automation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// ─── Manual Recipient Form ────────────────────────────────────────────────────

const ManualRecipientFormSchema = z.object({
  foiaEmail: z.string().email('Valid FOIA email is required'),
  foiaAddress: z.string().trim().min(1, 'FOIA mailing address is required'),
});

type ManualRecipientFormValues = z.input<typeof ManualRecipientFormSchema>;

interface ManualRecipientFormProps {
  orgId: string;
  projectId: string;
  oppId: string;
  onConfirm: () => void;
}

const ManualRecipientForm = ({ orgId, projectId, oppId, onConfirm }: ManualRecipientFormProps) => {
  const { toast } = useToast();
  const { confirmRecipient, isSaving } = useConfirmFoiaRecipient();

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ManualRecipientFormValues>({
    resolver: zodResolver(ManualRecipientFormSchema),
    mode: 'onChange',
  });

  const onSubmit = async (values: ManualRecipientFormValues) => {
    try {
      await confirmRecipient({
        orgId,
        projectId,
        oppId,
        foiaEmail: values.foiaEmail,
        foiaAddress: values.foiaAddress,
        saveToDirectory: true,
      });
      onConfirm();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save recipient',
        variant: 'destructive',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="foia-email" className="text-xs">
          FOIA Email <span className="text-destructive">*</span>
        </Label>
        <Input id="foia-email" type="email" placeholder="foia@agency.gov" {...register('foiaEmail')} />
        {errors.foiaEmail && <p className="text-xs text-destructive">{errors.foiaEmail.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="foia-address" className="text-xs">
          FOIA Mailing Address <span className="text-destructive">*</span>
        </Label>
        <Input
          id="foia-address"
          placeholder="123 Main St, Washington DC 20001"
          {...register('foiaAddress')}
        />
        {errors.foiaAddress && <p className="text-xs text-destructive">{errors.foiaAddress.message}</p>}
      </div>

      <Button type="submit" size="sm" disabled={isSaving || !isValid}>
        {isSaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : 'Confirm Recipient'}
      </Button>
    </form>
  );
};
