'use client';

import React, { useCallback, useState } from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { DownloadButton } from '@/components/ui/download-button';
import { DeleteButton } from '@/components/ui/delete-button';
import { cn } from '@/lib/utils';
import { useDeleteQuestionFile, useQuestionFiles, } from '@/lib/hooks/use-question-file';
import { useDownloadFromS3 } from '@/lib/hooks/use-file';
import PermissionWrapper from '@/components/permission-wrapper';
import {
  QuestionFileUploadDialog
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/question-extraction-dialog';

import { QuestionFileItem } from '@auto-rfp/shared';

interface ProjectDocumentsProps {
  projectId: string;
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
  const { items, isLoading, isError, error, refetch } = useQuestionFiles(projectId);
  const { trigger: deleteQuestionFile } = useDeleteQuestionFile();
  const { downloadFile, error: downloadError } = useDownloadFromS3();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleReload = useCallback(async () => {
    await refetch();
  }, [refetch]);


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

  const handleDelete = async (row: { questionFileId?: string; name: string; oppId?: string }) => {
    const { questionFileId, oppId, name } = row;
    if (!questionFileId) return;
    if (!oppId) return;
    if (deletingId === questionFileId) return;

    const ok = window.confirm(`Delete "${name}"?`);
    if (!ok) return;

    try {
      setDeletingId(questionFileId);
      await deleteQuestionFile({ projectId, questionFileId, oppId });
      await refetch();
    } finally {
      setDeletingId((prev) => (prev === questionFileId ? null : prev));
    }
  };

  const total = items?.length ?? 0;

  const emptyState = (
    <div className="text-center py-10">
      <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground mb-3"/>
      <h3 className="text-lg font-medium">No files yet</h3>
      <p className="text-muted-foreground mt-1">Upload a document to start extraction.</p>
    </div>
  );

  const renderQuestionFile = (f: QuestionFileItem) => {
    const st = statusChip(f.status);
    const rowStarting = !!f.questionFileId;
    const rowDeleting = !!f.questionFileId && deletingId === f.questionFileId;
    const rowDownloading = !!f.questionFileId && downloadingId === f.questionFileId;

    return (
      <div
        key={f.questionFileId ?? f.textFileKey}
        className={cn('rounded-lg border bg-background p-4 hover:bg-muted/50 transition-colors', (rowStarting || rowDeleting || rowDownloading) && 'opacity-80')}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-muted-foreground"/>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium truncate" title={f.originalFileName}>
                {f.originalFileName}
              </p>
              <Badge variant="outline" className={cn('text-xs border', st.cls)}>
                {st.label}
              </Badge>
            </div>

            <div className="mt-1 text-xs text-muted-foreground">
              Uploaded: {formatDate(f.createdAt)}
              {f.updatedAt ? ` • Updated: ${formatDate(f.updatedAt)}` : ''}
            </div>

            {typeof f.errorMessage === 'string' && f.errorMessage.length > 0 && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {f.errorMessage}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <DownloadButton
              isLoading={rowDownloading}
              disabled={!f.fileKey}
              variant={'ghost'}
              onClick={() => void handleDownload({
                questionFileId: f.questionFileId,
                fileKey: f.fileKey,
                name: f.originalFileName || 'unknown',
              })}
              ariaLabel={!f.fileKey ? 'No file key' : 'Download file'}
            />

            <PermissionWrapper requiredPermission={'question:delete'}>
              <DeleteButton
                isLoading={rowDeleting}
                disabled={!f.questionFileId}
                onClick={() => void handleDelete({
                  questionFileId: f.questionFileId,
                  name: f.originalFileName || 'unknown',
                  oppId: f.oppId
                })}
              />
            </PermissionWrapper>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <ListingPageLayout
        title="RFP Documents"
        description={`${total} ${total === 1 ? 'file' : 'files'} in this project`}
        headerActions={
          <QuestionFileUploadDialog projectId={projectId}/>
        }
        isLoading={isLoading}
        onReload={handleReload}
        emptyState={items.length === 0 ? emptyState : undefined}
        renderItem={renderQuestionFile}
        data={items}
      />
    </div>
  );
}
