'use client';

import { useState, useEffect } from 'react';
import { useDeleteQuestionFile, useStartQuestionFilePipeline, useStopQuestionPipeline } from '@/lib/hooks/use-question-file';
import { useToast } from './ui/use-toast';
import { CircleX, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PermissionWrapper from '@/components/permission-wrapper';

interface CancelPipelineButtonProps {
  projectId: string | undefined;
  opportunityId: string | undefined;
  questionFileId: string | undefined;
  status?: string;
  onSuccess?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
}

type CancellingState = 'idle' | 'cancelled' | 'deleting' | 'retrying';

export function CancelPipelineButton({
  projectId,
  opportunityId,
  questionFileId,
  status,
  onSuccess,
  onDelete,
  onRetry,
}: CancelPipelineButtonProps) {
  const [cancellingState, setCancellingState] = useState<CancellingState>(() => {
    return status === 'CANCELLED' ? 'cancelled' : 'idle';
  });
  const { trigger: stopPipeline, isMutating: isStopping } = useStopQuestionPipeline();
  const { trigger: deletePipeline } = useDeleteQuestionFile();
  const { trigger: startPipeline } = useStartQuestionFilePipeline();

  const { toast } = useToast();

  if (!projectId || !opportunityId || !questionFileId) {
    return null;
  }

  useEffect(() => {
    if (status === 'CANCELLED') {
      setCancellingState('cancelled');
    } else if (status === 'PROCESSING' || status === 'TEXTRACT_RUNNING' || status === 'TEXT_READY') {
      setCancellingState('idle');
    }
  }, [status]);

  const handleCancel = async () => {
    try {
      await stopPipeline({
        projectId,
        opportunityId,
        questionFileId,
      });
      setCancellingState('cancelled');
      onSuccess?.();
    } catch (error) {
      console.error('Failed to cancel pipeline:', error);
      setCancellingState('idle');
      toast({
        title: 'Error',
        description: 'Failed to cancel question file processing',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    try {
      setCancellingState('deleting');
      await deletePipeline({
        projectId,
        oppId: opportunityId,
        questionFileId,
      });
      onDelete?.();
    } catch (error) {
      console.error('Failed to delete file:', error);
      setCancellingState('cancelled');
      toast({
        title: 'Error',
        description: 'Failed to delete question file',
        variant: 'destructive',
      });
    }
  };

  const handleRetry = async () => {
    try {
      setCancellingState('retrying');
      await startPipeline({
        projectId,
        oppId: opportunityId,
        questionFileId,
      });
      onRetry?.();
      setCancellingState('idle');
    } catch (error) {
      console.error('Failed to retry pipeline:', error);
      setCancellingState('cancelled');
      toast({
        title: 'Error',
        description: 'Failed to retry question file processing',
        variant: 'destructive',
      });
    }
  };

  if (cancellingState === 'idle') {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleCancel}
        disabled={isStopping}
        className="gap-1.5"
      >
        {isStopping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CircleX className="h-3.5 w-3.5" />
        )}
      </Button>
    );
  }

  if (cancellingState === 'cancelled' || cancellingState === 'deleting') {
    return (
      <div className="flex gap-2 items-center">
        <PermissionWrapper requiredPermission={'question:delete'}>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            disabled={cancellingState === 'deleting'}
            className="gap-1.5"
          >
            {cancellingState === 'deleting' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </PermissionWrapper >
        <Button
          size="sm"
          variant="outline"
          onClick={handleRetry}
          disabled={cancellingState === 'deleting'}
          className="gap-1.5"
        >
          <RefreshCw />
        </Button>
      </div>
    );
  }

  return null;
}