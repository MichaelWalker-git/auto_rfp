import { useCallback, useMemo, useRef, useState } from 'react';
import { UploadFileToS3Ref } from '@/components/upload/UploadFileToS3';
import { UPLOAD_CONFIG, UploadQueueItem } from '../lib/upload-config';
import { validateFile, generateId } from '../lib/upload-validation';
import { z } from 'zod';

// Upload result validation schema
const UploadResultSchema = z.object({
  fileKey: z.string(),
  fileId: z.string(),
  sortKey: z.string(),
  fileName: z.string(),
});

interface UseDocumentUploadProps {
  kbId: string;
  orgId: string;
  createDocument: (data: {
    knowledgeBaseId: string;
    name: string;
    fileKey: string;
    textFileKey: string;
  }) => Promise<{ id: string }>;
  startPipeline: (data: {
    orgId: string;
    documentId: string;
    knowledgeBaseId: string;
  }) => Promise<unknown>;
  onUploadComplete?: () => Promise<unknown>;
}

export function useDocumentUpload({
  kbId,
  orgId,
  createDocument,
  startPipeline,
  onUploadComplete,
}: UseDocumentUploadProps) {
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploaderRef = useRef<UploadFileToS3Ref | null>(null);

  const uploadStats = useMemo(() => {
    const total = uploadQueue.length;
    const completed = uploadQueue.filter((x) => x.status === 'completed').length;
    const failed = uploadQueue.filter((x) => x.status === 'failed').length;
    const inProgress = uploadQueue.filter(
      (x) => x.status === 'uploading' || x.status === 'processing'
    ).length;
    const avgProgress =
      total > 0 ? uploadQueue.reduce((sum, x) => sum + x.progress, 0) / total : 0;

    return { total, completed, failed, inProgress, avgProgress };
  }, [uploadQueue]);

  const updateQueueItem = useCallback(
    (id: string, updates: Partial<UploadQueueItem>) => {
      setUploadQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
      );
    },
    []
  );

  const uploadSingleFile = useCallback(
    async (item: UploadQueueItem): Promise<void> => {
      if (!uploaderRef.current) {
        throw new Error('Uploader not initialized');
      }

      updateQueueItem(item.id, { status: 'uploading', progress: 0 });

      try {
        const uploadResult = await uploaderRef.current.upload(item.file);
        const parsed = UploadResultSchema.safeParse(uploadResult);

        if (!parsed.success) {
          throw new Error('Invalid upload result');
        }

        const { fileKey, fileName } = parsed.data;

        updateQueueItem(item.id, { status: 'processing', progress: 50 });

        const docResp = await createDocument({
          knowledgeBaseId: kbId,
          name: fileName,
          fileKey,
          textFileKey: `${fileKey}.txt`,
        });

        updateQueueItem(item.id, { documentId: docResp.id, progress: 75 });

        await startPipeline({
          orgId,
          documentId: docResp.id,
          knowledgeBaseId: kbId,
        });

        updateQueueItem(item.id, { status: 'completed', progress: 100 });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : 'Upload failed';
        updateQueueItem(item.id, {
          status: 'failed',
          error: errorMsg,
          retryCount: item.retryCount + 1,
        });
        throw error;
      }
    },
    [createDocument, kbId, startPipeline, updateQueueItem, orgId]
  );

  const onSelectFiles = useCallback((files: FileList | null) => {
    if (!files) return;

    const errors: string[] = [];
    const validItems: UploadQueueItem[] = [];

    if (files.length > UPLOAD_CONFIG.MAX_BATCH_SIZE) {
      errors.push(`Maximum ${UPLOAD_CONFIG.MAX_BATCH_SIZE} files allowed per batch`);
      setUploadErrors(errors);
      return;
    }

    Array.from(files).forEach((file) => {
      const validation = validateFile(file);

      if (!validation.valid) {
        errors.push(`${file.name}: ${validation.error}`);
      } else {
        validItems.push({
          id: generateId(),
          file,
          fileName: file.name,
          status: 'queued',
          progress: 0,
          retryCount: 0,
        });
      }
    });

    setUploadErrors(errors);
    setUploadQueue(validItems);
  }, []);

  const retryFailedItem = useCallback(
    async (itemId: string) => {
      const item = uploadQueue.find((x) => x.id === itemId);
      if (!item || item.retryCount >= UPLOAD_CONFIG.MAX_RETRY_ATTEMPTS) return;

      try {
        await uploadSingleFile(item);
      } catch (error) {
        console.error('Retry failed:', error);
      }
    },
    [uploadQueue, uploadSingleFile]
  );

  const runBatchUpload = useCallback(async () => {
    if (!uploadQueue.length || !uploaderRef.current) return;

    abortControllerRef.current = new AbortController();
    setIsBatchUploading(true);
    setUploadErrors([]);

    const errors: string[] = [];

    try {
      for (const item of uploadQueue) {
        if (abortControllerRef.current.signal.aborted) {
          updateQueueItem(item.id, { status: 'failed', error: 'Upload cancelled' });
          continue;
        }

        if (item.status === 'completed') continue;

        try {
          await uploadSingleFile(item);
        } catch (error: unknown) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${item.fileName}: ${errorMsg}`);
        }
      }

      setUploadErrors(errors);
    } finally {
      setIsBatchUploading(false);
      abortControllerRef.current = null;
      await onUploadComplete?.();
    }
  }, [uploadQueue, uploadSingleFile, updateQueueItem, onUploadComplete]);

  const cancelBatchUpload = useCallback(() => {
    abortControllerRef.current?.abort();
    uploaderRef.current?.abort();
    setIsBatchUploading(false);
  }, []);

  const resetUploadState = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setUploadQueue([]);
    setIsBatchUploading(false);
    setUploadErrors([]);
    uploaderRef.current?.reset?.();
  }, []);

  return {
    uploadQueue,
    isBatchUploading,
    uploadErrors,
    uploadStats,
    uploaderRef,
    onSelectFiles,
    retryFailedItem,
    runBatchUpload,
    cancelBatchUpload,
    resetUploadState,
  };
}
