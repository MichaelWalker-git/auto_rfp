'use client';

import type { SubmissionMethodDetected } from '@auto-rfp/core';
import { isPhysicalSubmission } from '@auto-rfp/core';
import { Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface PhysicalSubmissionChipProps {
  submissionMethod: SubmissionMethodDetected | null | undefined;
}

/**
 * Opportunity-card chip flagging a detected physical (mailed) submission
 * requirement. Renders nothing for ELECTRONIC, UNKNOWN, null, or undefined —
 * only PHYSICAL and BOTH require a mailed copy.
 */
export const PhysicalSubmissionChip = ({ submissionMethod }: PhysicalSubmissionChipProps) => {
  if (!isPhysicalSubmission(submissionMethod)) return null;

  return (
    <Badge
      variant="outline"
      className="text-xs h-4 px-1 bg-blue-100 text-blue-800 border-blue-200"
      data-testid="physical-submission-chip"
      aria-label="Physical submission required"
    >
      <Mail className="h-2.5 w-2.5 mr-0.5" />
      Physical Mail
    </Badge>
  );
};
