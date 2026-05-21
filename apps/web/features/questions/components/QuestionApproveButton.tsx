'use client';

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { useApproveQuestion } from '../hooks/useApproveQuestion';

interface QuestionApproveButtonProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  questionFileId: string;
  questionId: string;
  approvedAt?: string | null;
  approvedByName?: string | null;
  onApproved?: () => void;
}

const formatApprovalLabel = (approvedAt: string, approvedByName?: string | null) => {
  try {
    const d = new Date(approvedAt);
    const date = d.toLocaleDateString();
    return approvedByName ? `Approved by ${approvedByName} · ${date}` : `Approved ${date}`;
  } catch {
    return 'Approved';
  }
};

/**
 * Per-question approve button. Hidden once the question carries `approvedAt` —
 * replaced with a small inline label so the user can see who approved it.
 */
export const QuestionApproveButton = ({
  orgId, projectId, opportunityId, questionFileId, questionId,
  approvedAt, approvedByName, onApproved,
}: QuestionApproveButtonProps) => {
  const { toast } = useToast();
  const { approve, isApproving } = useApproveQuestion();

  const handleClick = useCallback(async () => {
    try {
      await approve({ orgId, projectId, opportunityId, questionFileId, questionId });
      onApproved?.();
    } catch (err) {
      toast({
        title: 'Failed to approve',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [approve, orgId, projectId, opportunityId, questionFileId, questionId, onApproved, toast]);

  if (approvedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {formatApprovalLabel(approvedAt, approvedByName)}
      </span>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={isApproving}
      className="gap-1.5"
    >
      {isApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {isApproving ? 'Approving…' : 'Approve'}
    </Button>
  );
};
