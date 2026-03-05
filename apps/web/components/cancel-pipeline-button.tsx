'use client';

import { useDeleteQuestionFile, useStartQuestionFilePipeline, useStopQuestionPipeline } from '@/lib/hooks/use-question-file';
import { useToast } from './ui/use-toast';
import { CircleX, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import PermissionWrapper from '@/components/permission-wrapper';

const CANCELLABLE_STATUSES = ['PROCESSING', 'TEXTRACT_RUNNING', 'TEXT_READY'] as const;
const CANCELLED_STATUSES = ['CANCELLED'] as const;

interface CancelPipelineButtonProps {
  projectId: string | undefined;
  opportunityId: string | undefined;
  questionFileId: string | undefined;
  /** Server-provided status — single source of truth */
  status?: string;
  /** Called after successful mutation — parent should refetch */
  onMutate?: () => void;
}

export const CancelPipelineButton = ({
  projectId,
  opportunityId,
  questionFileId,
  status,
  onMutate,
}: CancelPipelineButtonProps) => {
  const { trigger: stopPipeline, isMutating: isStopping } = useStopQuestionPipeline();
  const { trigger: deletePipeline, isMutating: isDeleting } = useDeleteQuestionFile();
  const { trigger: startPipeline, isMutating: isRetrying } = useStartQuestionFilePipeline();
  const { toast } = useToast();

  if (!projectId || !opportunityId || !questionFileId) return null;

  const isCancellable = CANCELLABLE_STATUSES.includes(status as typeof CANCELLABLE_STATUSES[number]);
  const isCancelled = CANCELLED_STATUSES.includes(status as typeof CANCELLED_STATUSES[number]);
  const isAnyMutating = isStopping || isDeleting || isRetrying;

  const handleCancel = async () => {
    try {
      await stopPipeline({ projectId, opportunityId, questionFileId });
      onMutate?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to cancel question file processing', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    try {
      await deletePipeline({ projectId, oppId: opportunityId, questionFileId });
      onMutate?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete question file', variant: 'destructive' });
    }
  };

  const handleRetry = async () => {
    try {
      await startPipeline({ projectId, oppId: opportunityId, questionFileId });
      onMutate?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to retry question file processing', variant: 'destructive' });
    }
  };

  // ── Cancel button for actively running pipelines ──────────────────────────
  if (isCancellable) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={isStopping}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              aria-label="Cancel pipeline"
            >
              {isStopping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CircleX className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Cancel processing</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // ── Delete + Retry buttons for cancelled pipelines ────────────────────────
  if (isCancelled) {
    return (
      <TooltipProvider>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRetry}
                disabled={isAnyMutating}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Retry pipeline"
              >
                {isRetrying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Retry processing</p>
            </TooltipContent>
          </Tooltip>

          <PermissionWrapper requiredPermission="question:delete">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDelete}
                  disabled={isAnyMutating}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  aria-label="Delete file"
                >
                  {isDeleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Delete file</p>
              </TooltipContent>
            </Tooltip>
          </PermissionWrapper>
        </div>
      </TooltipProvider>
    );
  }

  return null;
};
