'use client';

import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { FOIA_BLOCKED_REASON_LABELS } from '@auto-rfp/core';
import type { FoiaAutomationItem } from '@auto-rfp/core';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaStateSummaryProps {
  automation: FoiaAutomationItem;
  scheduledDate: Date | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FoiaStateSummary = ({ automation, scheduledDate }: FoiaStateSummaryProps) => {
  // SCHEDULED
  if (automation.state === 'SCHEDULED' && scheduledDate) {
    return (
      <div className="text-sm">
        <p className="text-muted-foreground">
          Scheduled to send on{' '}
          <span className="font-medium text-foreground">
            {format(scheduledDate, 'MMMM d, yyyy')}
          </span>
        </p>
      </div>
    );
  }

  // AWAITING_APPROVAL
  if (automation.state === 'AWAITING_APPROVAL') {
    return (
      <div className="text-sm space-y-1">
        <p className="font-medium">Awaiting approval from the configured approver.</p>
        {automation.approvalRequestedAt && (
          <p className="text-xs text-muted-foreground">
            Requested {format(new Date(automation.approvalRequestedAt), 'MMM d, yyyy')}
          </p>
        )}
      </div>
    );
  }

  // STALLED
  if (automation.state === 'STALLED') {
    return (
      <div className="text-sm space-y-1">
        <p className="font-medium text-orange-700">Approval is overdue.</p>
        {automation.stalledAt && (
          <p className="text-xs text-muted-foreground">
            Stalled since {format(new Date(automation.stalledAt), 'MMM d, yyyy')}
          </p>
        )}
      </div>
    );
  }

  // BLOCKED
  if (automation.state === 'BLOCKED' && automation.blockedReason) {
    return (
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          {FOIA_BLOCKED_REASON_LABELS[automation.blockedReason]}
        </p>
      </div>
    );
  }

  // SENT
  if (automation.state === 'SENT') {
    return (
      <div className="text-sm space-y-1">
        {automation.sentAt && (
          <p className="text-muted-foreground">
            Sent on {format(new Date(automation.sentAt), 'MMMM d, yyyy')}
          </p>
        )}
        {automation.resolvedRecipientEmail && (
          <p className="text-xs text-muted-foreground">
            Recipient: {automation.resolvedRecipientEmail}
          </p>
        )}
      </div>
    );
  }

  // BOUNCED
  if (automation.state === 'BOUNCED') {
    return (
      <div className="text-sm space-y-1">
        <p className="font-medium text-red-700">Email bounced.</p>
        {automation.bounceReason && (
          <p className="text-xs text-muted-foreground">{automation.bounceReason}</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          Verify the recipient email address and resend, or file the request manually via the
          agency's portal.
        </p>
      </div>
    );
  }

  // FAILED
  if (automation.state === 'FAILED') {
    return (
      <div className="text-sm space-y-1">
        <p className="font-medium text-red-700">Send failed.</p>
        {automation.lastError && (
          <p className="text-xs text-muted-foreground">{automation.lastError}</p>
        )}
        {automation.attemptCount && (
          <p className="text-xs text-muted-foreground">
            {automation.attemptCount} attempt{automation.attemptCount > 1 ? 's' : ''}
          </p>
        )}
      </div>
    );
  }

  // MANUAL_COMPLETED
  if (automation.state === 'MANUAL_COMPLETED') {
    return (
      <div className="text-sm text-muted-foreground">
        A human filed this request outside the app.
      </div>
    );
  }

  // SUPPRESSED
  if (automation.state === 'SUPPRESSED') {
    return (
      <div className="text-sm text-muted-foreground">
        Automation cancelled.
        {automation.suppressedReason && (
          <span className="block text-xs mt-1">{automation.suppressedReason}</span>
        )}
      </div>
    );
  }

  return null;
};
