'use client';

import { useState } from 'react';
import { Send, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PermissionButton } from '@/components/ui/permission-button';
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
import { useSendFoiaRequest } from '@/lib/hooks/use-foia-artifacts';
import { FOIALetterPreview } from './FOIALetterPreview';
import type { FoiaAutomationItem, FOIARequestItem } from '@auto-rfp/core';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaSendControlsProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  automation: FoiaAutomationItem;
  foiaRequest: FOIARequestItem | null;
  recipientEmail: string | null;
  onSendComplete?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FoiaSendControls = ({
  orgId,
  projectId,
  opportunityId,
  automation,
  foiaRequest,
  recipientEmail,
  onSendComplete,
}: FoiaSendControlsProps) => {
  const { toast } = useToast();
  const { sendFoiaRequest, isSending } = useSendFoiaRequest();

  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{
    recipient: string;
    subject: string;
    letter: string;
    attached: string[];
  } | null>(null);

  const handleReviewLetter = () => {
    if (!foiaRequest) {
      toast({
        title: 'No request found',
        description: 'The FOIA request has not been prepared yet.',
        variant: 'destructive',
      });
      return;
    }
    setIsPreviewOpen(true);
  };

  const handlePreviewDryRun = async () => {
    try {
      const result = await sendFoiaRequest({
        orgId,
        projectId,
        oppId: opportunityId,
        dryRun: true,
      });

      if (result.dryRun && result.letter && result.subject) {
        setDryRunResult({
          recipient: result.recipient,
          subject: result.subject,
          letter: result.letter,
          attached: result.attached,
        });
        toast({
          title: 'Preview generated',
          description: `Letter composed for ${result.recipient}. Attached: ${result.attached.join(', ')}.`,
        });
      }
    } catch (error) {
      toast({
        title: 'Preview failed',
        description: error instanceof Error ? error.message : 'Could not generate preview',
        variant: 'destructive',
      });
    }
  };

  const handleSendRequest = async () => {
    try {
      const result = await sendFoiaRequest({
        orgId,
        projectId,
        oppId: opportunityId,
        dryRun: false,
      });

      if (result.ok && result.sentAt) {
        toast({
          title: 'FOIA request sent',
          description: `Successfully sent to ${result.recipient}.`,
        });
        setIsSendDialogOpen(false);
        onSendComplete?.();
      }
    } catch (error) {
      toast({
        title: 'Send failed',
        description: error instanceof Error ? error.message : 'Failed to send FOIA request',
        variant: 'destructive',
      });
    }
  };

  if (!recipientEmail) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" onClick={handleReviewLetter} disabled={!foiaRequest}>
          <Eye className="h-3.5 w-3.5 mr-1" />
          Review letter
        </Button>

        <Button variant="outline" size="sm" onClick={handlePreviewDryRun} disabled={isSending}>
          {isSending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5 mr-1" />
          )}
          Preview (dry run)
        </Button>

        <PermissionButton
          requiredPermission="foia:send"
          size="sm"
          onClick={() => setIsSendDialogOpen(true)}
          disabled={isSending}
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          Send request
        </PermissionButton>
      </div>

      {/* Confirm Send Dialog */}
      <AlertDialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send FOIA request?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will transmit a legal public records request to{' '}
                <span className="font-medium text-foreground">{recipientEmail}</span>.
              </p>
              <p className="text-amber-600 font-medium">
                This action cannot be undone. The request will be sent to a government agency.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSendRequest} disabled={isSending}>
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send request'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Letter Preview Dialog */}
      {foiaRequest && (
        <FOIALetterPreview
          isOpen={isPreviewOpen}
          onOpenChange={setIsPreviewOpen}
          foiaRequest={foiaRequest}
          orgId={orgId}
          projectId={projectId}
          opportunityId={opportunityId}
        />
      )}

      {/* Dry Run Preview Dialog */}
      {dryRunResult && (
        <AlertDialog
          open={!!dryRunResult}
          onOpenChange={(open) => !open && setDryRunResult(null)}
        >
          <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Preview: FOIA Request</AlertDialogTitle>
              <AlertDialogDescription>
                To: {dryRunResult.recipient}
                <br />
                Subject: {dryRunResult.subject}
                <br />
                Attachments: {dryRunResult.attached.join(', ')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-muted/50 p-4 rounded-md max-h-[40vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm font-mono">{dryRunResult.letter}</pre>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDryRunResult(null)}>Close</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
};
