'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, FileText, FolderOpen, Loader2, Play, Trash2, Upload } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

import { usePresignUpload } from '@/lib/hooks/use-presign';
import {
  useCreateQuestionFile,
  useDeleteQuestionFile,
  useQuestionFiles,
  useStartQuestionFilePipeline,
} from '@/lib/hooks/use-question-file';
import { useDownloadFromS3 } from '@/lib/hooks/use-file';
import PermissionWrapper from '@/components/permission-wrapper';

interface ProjectDocumentsProps {
  projectId: string;
}

function pickDisplayName(qf: any): string {
  return (
    qf?.fileName ??
    qf?.originalFileName ??
    (typeof qf?.fileKey === 'string' ? qf.fileKey.split('/').pop() : undefined) ??
    'Unknown file'
  );
}

function formatDate(dateString?: string) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusChip(status?: string) {
  const s = String(status ?? '').toUpperCase();

  if (s === 'UPLOADED') return { label: 'Uploaded', cls: 'bg-slate-50 text-slate-700 border-slate-200' };
  if (s === 'QUESTIONS_EXTRACTED' || s === 'PROCESSED')
    return { label: 'Completed', cls: 'bg-green-50 text-green-700 border-green-200' };
  if (s === 'TEXT_READY' || s === 'TEXT_EXTRACTED')
    return { label: 'Text ready', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  if (s === 'PROCESSING') return { label: 'Processing', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (s === 'TEXT_EXTRACTION_FAILED' || s === 'ERROR' || s === 'FAILED')
    return { label: 'Error', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (s === 'DELETED') return { label: 'Deleted', cls: 'bg-gray-50 text-gray-700 border-gray-200' };
  return { label: 'Processing', cls: 'bg-slate-50 text-slate-700 border-slate-200' };
}

export function ProjectDocuments({ projectId }: ProjectDocumentsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { items, isLoading, isError, error, refetch } = useQuestionFiles(projectId);

  const { trigger: getPresignedUrl, isMutating: isGettingPresigned } = usePresignUpload();
  const { trigger: createQuestionFile, isMutating: isCreating } = useCreateQuestionFile(projectId);

  const { trigger: startPipeline } = useStartQuestionFilePipeline(projectId);
  const { trigger: deleteQuestionFile } = useDeleteQuestionFile();

  const { downloadFile, error: downloadError } = useDownloadFromS3();

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const [startingId, setStartingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    return (items ?? []).map((qf: any) => ({
      questionFileId: qf?.questionFileId as string | undefined,
      name: pickDisplayName(qf),
      status: qf?.status as string | undefined,
      createdAt: qf?.createdAt as string | undefined,
      updatedAt: qf?.updatedAt as string | undefined,
      fileKey: qf?.fileKey as string | undefined,
      errorMessage: qf?.errorMessage as string | undefined,
    }));
  }, [items]);

  const busyUpload = uploadBusy || isGettingPresigned || isCreating;

  const onPickFile = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (file: File) => {
    try {
      setUploadError(null);
      setUploadBusy(true);

      const presigned = await getPresignedUrl({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
      });

      const uploadRes = await fetch(presigned.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => '');
        throw new Error(text || 'Failed to upload file to S3');
      }

      await createQuestionFile({
        originalFileName: file.name,
        fileKey: presigned.key,
        mimeType: file.type,
      });

      await refetch();
    } catch (e: any) {
      setUploadError(e?.message || 'Unexpected error');
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (row: { questionFileId?: string; fileKey?: string; name: string }) => {
    if (!row.questionFileId || !row.fileKey) return;
    if (downloadingId === row.questionFileId) return;

    try {
      setDownloadingId(row.questionFileId);
      await downloadFile({ key: row.fileKey, fileName: row.name });
    } finally {
      setDownloadingId((prev) => (prev === row.questionFileId ? null : prev));
    }
  };

  const handleDelete = async (row: { questionFileId?: string; name: string }) => {
    if (!row.questionFileId) return;
    if (deletingId === row.questionFileId) return;

    const ok = window.confirm(`Delete "${row.name}"?`);
    if (!ok) return;

    try {
      setDeletingId(row.questionFileId);
      await deleteQuestionFile({ projectId, questionFileId: row.questionFileId });
      await refetch();
    } finally {
      setDeletingId((prev) => (prev === row.questionFileId ? null : prev));
    }
  };

  const handleStart = async (row: { questionFileId?: string }) => {
    if (!row.questionFileId) return;
    if (startingId === row.questionFileId) return;

    try {
      setStartingId(row.questionFileId);
      await startPipeline({ projectId, questionFileId: row.questionFileId });
      await refetch();
    } finally {
      setStartingId((prev) => (prev === row.questionFileId ? null : prev));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              RFP Documents
            </CardTitle>
            <CardDescription>Upload a document and run question extraction</CardDescription>
          </div>
          <Skeleton className="h-9 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              RFP Documents
            </CardTitle>
            <CardDescription>Upload a document and run question extraction</CardDescription>
          </div>

          <Button onClick={onPickFile} disabled={busyUpload} className="gap-2">
            {busyUpload ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload file
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="rounded-xl border bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-900">Couldn’t load files</p>
                <p className="text-sm text-red-700 mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {uploadError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>
          )}

          {downloadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Download failed: {downloadError.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileSelected(f);
          }}
        />
      </Card>
    );
  }

  const total = items?.length ?? 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            RFP Documents
          </CardTitle>
          <CardDescription>
            {total} {total === 1 ? 'file' : 'files'} in this project
          </CardDescription>
        </div>

        <Button onClick={onPickFile} disabled={busyUpload} className="gap-2">
          {busyUpload ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload file
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {uploadError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>
        )}

        {downloadError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Download failed: {downloadError.message}</AlertDescription>
          </Alert>
        )}

        {total === 0 ? (
          <div className="text-center py-10">
            <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground mb-3" />
            <h3 className="text-lg font-medium">No files yet</h3>
            <p className="text-muted-foreground mt-1">Upload a document to start extraction.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((f) => {
              const st = statusChip(f.status);
              const statusUpper = String(f.status ?? '').toUpperCase();
              const isProcessing = statusUpper === 'PROCESSING';
              const canStart = !!f.questionFileId && statusUpper === 'UPLOADED';

              const rowStarting = !!f.questionFileId && startingId === f.questionFileId;
              const rowDeleting = !!f.questionFileId && deletingId === f.questionFileId;
              const rowDownloading = !!f.questionFileId && downloadingId === f.questionFileId;

              return (
                <div
                  key={f.questionFileId ?? f.name}
                  className={cn('rounded-xl border bg-background p-3', (rowStarting || rowDeleting || rowDownloading) && 'opacity-80')}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate" title={f.name}>
                          {f.name}
                        </p>
                        <Badge variant="outline" className={cn('text-xs border', st.cls)}>
                          {st.label}
                        </Badge>
                      </div>

                      <div className="mt-1 text-xs text-muted-foreground">
                        Uploaded: {formatDate(f.createdAt)}
                        {f.updatedAt ? ` • Updated: ${formatDate(f.updatedAt)}` : ''}
                      </div>

                      {typeof f.fileKey === 'string' && f.fileKey.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground truncate" title={f.fileKey}>
                          Key: {f.fileKey}
                        </div>
                      )}

                      {typeof f.errorMessage === 'string' && f.errorMessage.length > 0 && (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                          {f.errorMessage}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">

                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        disabled={!canStart || rowStarting}
                        onClick={() => void handleStart({ questionFileId: f.questionFileId })}
                      >
                        {rowStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        Start extraction
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        disabled={!f.fileKey || rowDownloading}
                        onClick={() => void handleDownload({ questionFileId: f.questionFileId, fileKey: f.fileKey, name: f.name })}
                        title={!f.fileKey ? 'No file key' : 'Download file'}
                      >
                        {rowDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>

                      <PermissionWrapper requiredPermission={'question:delete'}>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-2"
                          disabled={!f.questionFileId || rowDeleting}
                          onClick={() => void handleDelete({ questionFileId: f.questionFileId, name: f.name })}
                        >
                          {rowDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </PermissionWrapper>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFileSelected(f);
        }}
      />
    </Card>
  );
}