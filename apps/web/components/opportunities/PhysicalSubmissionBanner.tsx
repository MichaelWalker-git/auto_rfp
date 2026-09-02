'use client';

import { Mail, Send } from 'lucide-react';
import type { OpportunityItem, SubmissionMethodDetected } from '@auto-rfp/core';
import {
  DEFAULT_MAIL_TRANSIT_BUSINESS_DAYS,
  computeMailDeadline,
  formatFoiaComponentAddress,
  isPhysicalSubmission,
} from '@auto-rfp/core';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { useUpdateOpportunity } from '@/lib/hooks/use-opportunities';

interface PhysicalSubmissionBannerProps {
  orgId: string;
  projectId: string;
  oppId: string;
  opportunity: OpportunityItem | null | undefined;
  isLoading?: boolean;
  /** Re-fetches the opportunity so the banner reflects the toggle immediately. */
  refetch: () => void;
}

const formatMailDeadline = (deadline: string | null): string | null => {
  if (!deadline) return null;
  return new Date(`${deadline}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * Warning banner shown on the opportunity detail page when a solicitation has a
 * detected physical (mailed) submission requirement. Includes a toggle so a user
 * can correct a mis-detection — toggling off PATCHes `submissionMethod` to
 * ELECTRONIC, which hides the banner on the next render.
 */
export const PhysicalSubmissionBanner = ({
  orgId,
  projectId,
  oppId,
  opportunity,
  isLoading = false,
  refetch,
}: PhysicalSubmissionBannerProps) => {
  const { trigger, isMutating } = useUpdateOpportunity(orgId);
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div
        data-testid="physical-submission-banner-skeleton"
        className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }

  const submissionMethod = opportunity?.submissionMethod;
  if (!isPhysicalSubmission(submissionMethod)) return null;

  const address = formatFoiaComponentAddress(opportunity?.submissionMailingAddress);
  const mailDeadline = formatMailDeadline(
    computeMailDeadline(opportunity?.responseDeadlineIso, DEFAULT_MAIL_TRANSIT_BUSINESS_DAYS),
  );

  const handleToggle = async (checked: boolean) => {
    try {
      await trigger({
        projectId,
        oppId,
        patch: { submissionMethod: (checked ? 'PHYSICAL' : 'ELECTRONIC') as SubmissionMethodDetected },
      });
      refetch();
    } catch (err: unknown) {
      toast({
        title: 'Failed to update submission method',
        description: (err as Error)?.message || 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div
      role="alert"
      data-testid="physical-submission-banner"
      className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
    >
      <div className="flex items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="font-medium">Physical Submission Required ({submissionMethod})</div>
          {address && (
            <div data-testid="physical-submission-address" className="text-amber-800/90">
              Mail to: {address}
            </div>
          )}
          {mailDeadline && (
            <div data-testid="physical-submission-deadline" className="flex items-center gap-1 text-amber-800/90">
              <Send className="h-3 w-3" />
              Mail by {mailDeadline} to arrive on time
            </div>
          )}
          {opportunity?.submissionMethodRationale && (
            <div className="text-xs italic text-amber-700/90">
              &ldquo;{opportunity.submissionMethodRationale}&rdquo;
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <Switch
          id="physical-submission-toggle"
          checked={isPhysicalSubmission(submissionMethod)}
          disabled={isMutating}
          onCheckedChange={handleToggle}
          aria-label="Requires physical submission"
        />
        <label htmlFor="physical-submission-toggle" className="text-xs text-amber-800/90">
          Requires physical (mailed) submission
        </label>
      </div>
    </div>
  );
};
