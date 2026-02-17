'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { PageSearch } from '@/components/layout/page-search';
import { AlertCircle, CheckCircle2, FileText, Loader2, PlusCircle, RotateCw, Upload, XCircle } from 'lucide-react';
import { DownloadButton } from '@/components/ui/download-button';
import { DeleteButton } from '@/components/ui/delete-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

import { useKnowledgeBase } from '@/lib/hooks/use-knowledgebase';
import {
  useCreateDocument,
  useDeleteDocument,
  useDocumentsByKb,
  useDownloadDocument,
  useStartDocumentPipeline,
} from '@/lib/hooks/use-document';
import { useAuth } from '@/components/AuthProvider';

import { DocumentItem, IndexStatus, UploadResultSchema } from '@auto-rfp/shared';

import { UploadFileToS3, type UploadFileToS3Ref, } from '@/components/upload/UploadFileToS3';
import PermissionWrapper from '@/components/permission-wrapper';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { ArrowRight, Shield } from 'lucide-react';

interface KbDocument {
  id: string;
  name: string;
  fileKey: string;
  textFileKey?: string;
  indexStatus: IndexStatus;
  createdAt: string;
  updatedAt: string;
  knowledgeBaseId: string;
  chunksCount?: number;
  jobId?: string;
}

type UploadStatus = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';

interface UploadQueueItem {
  id: string;
  file: File;
  fileName: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  retryCount: number;
  documentId?: string;
}

const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_BATCH_SIZE: 100,
  MAX_RETRY_ATTEMPTS: 3,
  ALLOWED_TYPES: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  ALLOWED_EXTENSIONS: ['.pdf', '.doc', '.docx', '.txt', '.csv', '.xls', '.xlsx'],
} as const;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function statusVariant(status: IndexStatus): 'default' | 'destructive' | 'secondary' {
  if (status === 'INDEXED' || status === 'CHUNKED') return 'default';
  if (status === 'FAILED') return 'destructive';
  return 'secondary';
}

function statusLabel(status: IndexStatus): string {
  switch (status) {
    case 'INDEXED':
      return 'Indexed';
    case 'CHUNKED':
      return 'Chunked';
    case 'FAILED':
      return 'Failed';
    default:
      return status;
  }
}

function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File exceeds maximum size of ${UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
  const isValidType =
    UPLOAD_CONFIG.ALLOWED_TYPES.find(s => s === file.type) ||
    UPLOAD_CONFIG.ALLOWED_EXTENSIONS.find(s => s === extension);

  if (!isValidType) {
    return {
      valid: false,
      error: `File type not supported. Allowed: ${UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  return { valid: true };
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export default function KnowledgeBaseItemComponent() {
  const { orgId, kbId } = useParams<{ orgId: string; kbId: string }>();
  const { data: kb, isLoading: kbLoading, error: kbError } = useKnowledgeBase(kbId, orgId);
  const {
    data: documents,
    isLoading: docsLoading,
    mutate: refreshDocuments,
  } = useDocumentsByKb(kbId);

  const { trigger: startPipeline } = useStartDocumentPipeline();
  const { trigger: createDocument } = useCreateDocument();
  const { trigger: deleteDocument, isMutating: isDeleting } = useDeleteDocument();
  const { trigger: downloadDocument, isMutating: isDownloading, error: downloadError } = useDownloadDocument();
  const { userSub } = useAuth();

  const isLoading = kbLoading || docsLoading;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [docToDelete, setDocToDelete] = useState<KbDocument | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploaderRef = useRef<UploadFileToS3Ref | null>(null);

  const docs = useMemo(() => {
    if (!Array.isArray(documents)) return [];

    return documents.filter((doc) => {
      return (
        doc &&
        typeof doc === 'object' &&
        'id' in doc &&
        'name' in doc &&
        'fileKey' in doc &&
        'indexStatus' in doc
      );
    });
  }, [documents]);

  const totalDocs = docs.length;
  const readyDocs = docs.filter((d) => d.indexStatus === 'INDEXED').length;

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return docs;
    const query = searchQuery.toLowerCase();
    return docs.filter((doc) => doc.name.toLowerCase().includes(query));
  }, [docs, searchQuery]);

  // ---- Upload statistics ----
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

  // ============================================================================
  // UPLOAD HANDLERS
  // ============================================================================

  const resetUploadState = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setUploadQueue([]);
    setIsBatchUploading(false);
    setUploadErrors([]);
    uploaderRef.current?.reset?.();
  }, []);

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
      } catch (error: any) {
        const errorMsg = error?.message || 'Upload failed';
        updateQueueItem(item.id, {
          status: 'failed',
          error: errorMsg,
          retryCount: item.retryCount + 1,
        });
        throw error;
      }
    },
    [createDocument, kbId, startPipeline, updateQueueItem]
  );

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
        } catch (error: any) {
          errors.push(`${item.fileName}: ${error?.message || 'Unknown error'}`);
        }
      }

      setUploadErrors(errors);
    } finally {
      setIsBatchUploading(false);
      abortControllerRef.current = null;
      await refreshDocuments();
    }
  }, [uploadQueue, uploadSingleFile, updateQueueItem, refreshDocuments]);

  const cancelBatchUpload = useCallback(() => {
    abortControllerRef.current?.abort();
    uploaderRef.current?.abort();
    setIsBatchUploading(false);
  }, []);

  const handleDeleteClick = useCallback((doc: KbDocument) => {
    setDocToDelete(doc);
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!docToDelete) return;

    try {
      await deleteDocument({ knowledgeBaseId: kbId, id: docToDelete.id, orgId });
    } finally {
      setDocToDelete(null);
      setShowDeleteConfirm(false);
      await refreshDocuments();
    }
  }, [docToDelete, deleteDocument, kbId, refreshDocuments]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setDocToDelete(null);
  }, []);

  const renderUploadQueueItem = useCallback(
    (item: UploadQueueItem) => (
      <div
        key={item.id}
        className="flex items-start gap-3 p-3 border rounded-md bg-card hover:bg-muted/50 transition-colors"
      >
        <div className="mt-0.5">
          {item.status === 'completed' && (
            <CheckCircle2 className="h-5 w-5 text-emerald-500"/>
          )}
          {item.status === 'failed' && <XCircle className="h-5 w-5 text-red-500"/>}
          {(item.status === 'uploading' || item.status === 'processing') && (
            <Loader2 className="h-5 w-5 text-blue-500 animate-spin"/>
          )}
          {item.status === 'queued' && <FileText className="h-5 w-5 text-muted-foreground"/>}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{item.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(item.file.size)}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {item.status === 'failed' &&
                item.retryCount < UPLOAD_CONFIG.MAX_RETRY_ATTEMPTS && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => retryFailedItem(item.id)}
                    disabled={isBatchUploading}
                  >
                    <RotateCw className="h-3 w-3 mr-1"/>
                    Retry
                  </Button>
                )}
            </div>
          </div>

          {(item.status === 'uploading' || item.status === 'processing') && (
            <Progress value={item.progress} className="h-1.5"/>
          )}

          {item.error && (
            <p className="text-xs text-red-500 flex items-start gap-1">
              <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0"/>
              <span>{item.error}</span>
            </p>
          )}

          {item.status === 'completed' && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Successfully uploaded
            </p>
          )}
        </div>
      </div>
    ),
    [isBatchUploading, retryFailedItem]
  );

  if (kbError) {
    return (
      <div className="container mx-auto p-12">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4"/>
          <AlertDescription>
            Failed to load knowledge base: {kbError.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const description = isLoading
    ? 'Loading documents...'
    : `${totalDocs} ${totalDocs === 1 ? 'document' : 'documents'} · ${readyDocs} indexed`;

  const renderDoc = (doc: DocumentItem) => (
    <Card
      key={doc.id}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60 transition-colors"
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="mt-0.5">
          <FileText className="h-5 w-5 text-muted-foreground"/>
        </div>

        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">{doc.name}</span>

            <Badge
              variant={statusVariant(doc.indexStatus)}
              className="text-[10px] uppercase tracking-wide flex items-center gap-1.5"
            >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              doc.indexStatus === 'INDEXED'
                                ? 'bg-emerald-500'
                                : doc.indexStatus === 'FAILED'
                                  ? 'bg-red-500'
                                  : 'bg-amber-500'
                            }`}
                          />
              {statusLabel(doc.indexStatus)}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            Uploaded {new Date(doc.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
            {doc.createdBy && (
              <span> by {doc.createdBy === userSub ? 'you' : doc.createdBy.slice(0, 8) + '…'}</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Download button — only visible to the user who uploaded the document */}
        {(!doc.createdBy || doc.createdBy === userSub) && (
          <DownloadButton
            isLoading={isDownloading}
            onClick={async () => {
              try {
                const result = await downloadDocument({ documentId: doc.id, kbId: doc.knowledgeBaseId });
                if (result?.url) {
                  window.open(result.url, '_blank');
                }
              } catch {
                // Error is handled by the downloadError state from the hook
              }
            }}
            ariaLabel={`Download ${doc.name}`}
            variant="ghost"
            size="icon"
            className="h-9 w-9"
          />
        )}
        <PermissionWrapper requiredPermission={'document:delete'}>
          <DeleteButton
            isLoading={isDeleting}
            onClick={() => handleDeleteClick(doc)}
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
          />
        </PermissionWrapper>
      </div>
    </Card>
  );

  return (
    <div className="container mx-auto p-12">
      <ListingPageLayout
        title={kb?.name || 'Knowledge Base'}
        description={description}
        isLoading={isLoading}
        onReload={() => {
          refreshDocuments()
        }}
        headerActions={
          <div className="flex items-center gap-2">
            <PageSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search documents..."
            />
            <PermissionWrapper requiredPermission={'kb:edit'}>
              {orgId && kbId && (
                <Button variant="outline" asChild>
                  <Link href={`/organizations/${orgId}/knowledge-base/${kbId}/access`}>
                    <Shield className="h-4 w-4 mr-2"/>
                    Access Control
                  </Link>
                </Button>
              )}
            </PermissionWrapper>
            <PermissionWrapper requiredPermission={'kb:upload'}>
              <Button onClick={() => setShowUpload(true)}>
                <PlusCircle className="h-4 w-4 mr-2"/>
                Upload Documents
              </Button>
            </PermissionWrapper>
          </div>
        }
        data={filteredDocs}
        renderItem={renderDoc}
        isEmpty={!isLoading && filteredDocs.length === 0}
        emptyState={
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/10 px-12 py-20 mx-4 my-8">
            <div className="rounded-full bg-muted p-4 mb-6">
              <FileText className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No documents yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Upload your first documents to start indexing and enable Q&amp;A capabilities.
              Supported formats include PDF, Word, Excel, CSV, and plain text files.
            </p>
            <PermissionWrapper requiredPermission="document:create">
              <Button size="lg" onClick={() => setShowUpload(true)}>
                <Upload className="h-5 w-5 mr-2" />
                Upload Your First Documents
              </Button>
            </PermissionWrapper>
          </div>
        }
      >
        {downloadError && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4"/>
            <AlertDescription>
              Download failed: {downloadError.message}
            </AlertDescription>
          </Alert>
        )}
      </ListingPageLayout>

      <Dialog
        open={showUpload}
        onOpenChange={(open) => {
          if (!isBatchUploading) {
            setShowUpload(open);
            if (!open) resetUploadState();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Upload Documents</DialogTitle>
            <DialogDescription>
              Select up to {UPLOAD_CONFIG.MAX_BATCH_SIZE} files. Maximum size per file:{' '}
              {UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-y-auto">
            <div className="space-y-2">
              <label
                htmlFor="file-upload"
                className="block text-sm font-medium text-foreground"
              >
                Select Files
              </label>
              <input
                id="file-upload"
                type="file"
                multiple
                accept={UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(',')}
                onChange={(e) => onSelectFiles(e.target.files)}
                disabled={isBatchUploading}
                className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground">
                Supported formats: {UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}
              </p>
            </div>

            <div className="hidden">
              {orgId && kbId && (
                <UploadFileToS3 ref={uploaderRef} prefix={`org_${orgId}/kb_${kbId}`}/>
              )}
            </div>

            {uploadErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4"/>
                <AlertDescription>
                  <p className="font-medium mb-1">File validation errors:</p>
                  <ul className="list-disc list-inside text-xs space-y-0.5">
                    {uploadErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {uploadQueue.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">
                    Upload Queue ({uploadStats.completed}/{uploadStats.total})
                  </h3>
                  {isBatchUploading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin"/>
                      <span>Uploading...</span>
                    </div>
                  )}
                </div>

                {isBatchUploading && (
                  <div className="space-y-1">
                    <Progress value={uploadStats.avgProgress} className="h-2"/>
                    <p className="text-xs text-muted-foreground text-center">
                      Overall Progress: {Math.round(uploadStats.avgProgress)}%
                    </p>
                  </div>
                )}

                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                  {uploadQueue.map(renderUploadQueueItem)}
                </div>

                {uploadStats.failed > 0 && !isBatchUploading && (
                  <Alert>
                    <AlertCircle className="h-4 w-4"/>
                    <AlertDescription className="text-xs">
                      {uploadStats.failed} file(s) failed to upload. You can retry individual
                      files.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {isBatchUploading ? (
              <Button variant="destructive" onClick={cancelBatchUpload}>
                <XCircle className="h-4 w-4 mr-2"/>
                Cancel Upload
              </Button>
            ) : (
              <div className="space-x-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setUploadQueue([]);
                    setShowUpload(false);
                  }}
                  disabled={isBatchUploading}
                >
                  Close
                </Button>

                <Button
                  onClick={runBatchUpload}
                  disabled={
                    !uploadQueue.length ||
                    isBatchUploading ||
                    uploadQueue.every((x) => x.status === 'completed')
                  }
                >
                  <Upload className="h-4 w-4 mr-2"/>
                  Upload {uploadQueue.length > 0 ? `(${uploadQueue.length})` : ''}
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold text-foreground">{docToDelete?.name}</span>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDelete} disabled={isDeleting}>
              Cancel
            </Button>

            <DeleteButton onClick={handleConfirmDelete} isLoading={isDeleting}/>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}