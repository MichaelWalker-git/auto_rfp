'use client';

import { useDeleteQuestionFile, useStartQuestionFilePipeline, useStopQuestionPipeline } from '@/lib/hooks/use-question-file';
import { useToast } from './ui/use-toast';
import { CircleX, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PermissionWrapper from '@/components/permission-wrapper';

/**
 * Pipeline statuses that indicate the pipeline is actively running
 * and can be cancelled.
 */
const CANCELLABLE_STATUSES = ['PROCESSING', 'TEXTRACT_RUNNING', 'TEXT_READY'] as const;

/**
 * Pipeline statuses that indicate the pipeline was cancelled
 * and can be deleted or retried.
 */
const CANCELLED_STATUSES = ['CANCELLED'] as const;

interface CancelPipelineButtonProps {
  projectId: string | undefined;
  opportunityId: string | undefined;
  questionFileId: string | undefined;
  /** Server-provided status - this is the single source of truth */
  status?: string;
  /** Called after successful mutation - parent should refetch data */
  onMutate?: () => void;
}

/**
 * Server-driven cancel/delete/retry button for question file pipelines.
 *
 * This component renders based entirely on the server-provided `status` prop.
 * It does NOT maintain local state for the pipeline status - the server is
 * the single source of truth. Only transient loading states (isStopping,
 * isDeleting, isRetrying) are tracked locally.
 *
 * After any mutation, the `onMutate` callback is called so the parent can
 * refetch the latest server state.
 */
export function CancelPipelineButton({
  projectId,
  opportunityId,
  questionFileId,
  status,
  onMutate,
}: CancelPipelineButtonProps) {
  const { trigger: stopPipeline, isMutating: isStopping } = useStopQuestionPipeline();
  const { trigger: deletePipeline, isMutating: isDeleting } = useDeleteQuestionFile();
  const { trigger: startPipeline, isMutating: isRetrying } = useStartQuestionFilePipeline();

  const { toast } = useToast();

  // Early return if missing required props
  if (!projectId || !opportunityId || !questionFileId) {
    return null;
  }

  const isCancellable = CANCELLABLE_STATUSES.includes(status as typeof CANCELLABLE_STATUSES[number]);
  const isCancelled = CANCELLED_STATUSES.includes(status as typeof CANCELLED_STATUSES[number]);
  const isAnyMutating = isStopping || isDeleting || isRetrying;

  const handleCancel = async () => {
    try {
      await stopPipeline({
        projectId,
        opportunityId,
        questionFileId,
      });
      onMutate?.();
    } catch (error) {
      console.error('Failed to cancel pipeline:', error);
      toast({
        title: 'Error',
        description: 'Failed to cancel question file processing',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deletePipeline({
        projectId,
        oppId: opportunityId,
        questionFileId,
      });
      onMutate?.();
    } catch (error) {
      console.error('Failed to delete file:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete question file',
        variant: 'destructive',
      });
    }
  };

  const handleRetry = async () => {
    try {
      await startPipeline({
        projectId,
        oppId: opportunityId,
        questionFileId,
      });
      onMutate?.();
    } catch (error) {
      console.error('Failed to retry pipeline:', error);
      toast({
        title: 'Error',
        description: 'Failed to retry question file processing',
        variant: 'destructive',
      });
    }
  };

  // Render cancel button for running pipelines
  if (isCancellable) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleCancel}
        disabled={isStopping}
        className="gap-1.5"
        aria-label="Cancel pipeline"
      >
        {isStopping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CircleX className="h-3.5 w-3.5" />
        )}
      </Button>
    );
  }

  // Render delete/retry buttons for cancelled pipelines
  if (isCancelled) {
    return (
      <div className="flex gap-2 items-center">
        <PermissionWrapper requiredPermission={'question:delete'}>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            disabled={isAnyMutating}
            className="gap-1.5"
            aria-label="Delete file"
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </PermissionWrapper>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRetry}
          disabled={isAnyMutating}
          className="gap-1.5"
          aria-label="Retry pipeline"
        >
          {isRetrying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    );
  }

  // Don't render anything for other statuses (COMPLETED, FAILED, etc.)
  return null;
}