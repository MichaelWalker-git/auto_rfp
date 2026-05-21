'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { useMarkFormReviewed } from '../hooks/useMarkFormReviewed';
import { useToast } from '@/components/ui/use-toast';

interface FormReviewButtonProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
  isReviewed: boolean;
  onReviewed: () => void;
}

export const FormReviewButton = ({
  orgId, projectId, opportunityId, formId, isReviewed, onReviewed,
}: FormReviewButtonProps) => {
  const { toast } = useToast();
  const { markReviewed } = useMarkFormReviewed();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isReviewed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4" />
        Reviewed
      </span>
    );
  }

  const handleClick = async () => {
    setIsSubmitting(true);
    try {
      await markReviewed({ orgId, projectId, opportunityId, formId });
      onReviewed();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to mark as reviewed',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={isSubmitting} variant="outline" size="sm" className="gap-1.5">
      <CheckCircle2 className="h-4 w-4" />
      {isSubmitting ? 'Saving...' : 'Mark as reviewed'}
    </Button>
  );
};
