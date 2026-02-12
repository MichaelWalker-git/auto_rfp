'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import PermissionWrapper from '@/components/permission-wrapper';
import { CancelPipelineButton } from '@/components/cancel-pipeline-button';
import { useDeleteQuestionFile, useQuestionFiles } from '@/lib/hooks/use-question-file';
import { useDownloadFromS3 } from '@/lib/hooks/use-file';
import { useToast } from '@/components/ui/use-toast';
import {
  QuestionFileUploadDialog,
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/question-extraction-dialog';
import { useOpportunityContext } from './opportunity-context';
import { formatDateTime, getStatusChip, pickDisplayName } from './opportunity-helpers';

interface AttachmentRow {
  questionFileId: string | undefined;
  name: string;
  status: string | undefined;
  createdAt: string | undefined;
  updatedAt: string | undefined;
  fileKey: string | undefined;
  errorMessage: string | undefined;
}

/**
 * Solicitation Documents section — displays question files (solicitation attachments)
 * uploaded for this opportunity. Supports upload, download, delete, and pipeline cancellation.
 */
export function OpportunitySolicitationDocuments() {
  const { projectId, oppId } = useOpportunityContext();
  const { toast } = useToast();

  const {
    items: qItems,
    isLoading: isLoadingFiles,
    isError: isFilesError,
    error: filesError,
    refetch: refetchFiles,
  } = useQuestionFiles(projectId, { oppId });

  const { downloadFile, error: downloadError } = useDownloadFromS3();
  const { trigger: deleteQuestionFile } = useDeleteQuestionFile();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const rows = useMemo<AttachmentRow[]>(
    () =>
      (qItems ?? []).map((qf: any) => ({
        questionFileId: qf?.questionFileId,
        name: pickDisplayName(qf),
        status: qf?.status,
        createdAt: qf?.createdAt,
        updatedAt: qf?.updatedAt,
        fileKey: qf?.fileKey,
        errorMessage: qf?.errorMessage,
      })),
    [qItems],
  );

  const handleDownload = useCallback(
    async (row: AttachmentRow) => {
      if (!row.questionFileId || !row.fileKey || downloadingId === row.questionFileId) return;
      try {
        setDownloadingId(row.questionFileId);
        await downloadFile({ key: row.fileKey, fileName: row.name });
      } finally {
        setDownloadingId((prev) => (prev === row.questionFileId ? null : prev));
      }
    },
    [downloadingId, downloadFile],
  );

  const handleDelete = useCallback(
    async (row: AttachmentRow) => {
      if (!row.questionFileId || deletingId === row.questionFileId) return;
      if (!window.confirm(`Delete "${row.name}"?`)) return;
      try {
        setDeletingId(row.questionFileId);
        await deleteQuestionFile({ projectId, oppId, questionFileId: row.questionFileId });
        await refetchFiles();
      } finally {
        setDeletingId((prev) => (prev === row.questionFileId ? null : prev));
      }
    },
    [projectId, oppId, deletingId, deleteQuestionFile, refetchFiles],
  );

  // Loading skeleton
  if (isLoadingFiles && rows.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Solicitation Documents</CardTitle>
          <Skeleton className="h-8 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">Solicitation Documents</CardTitle>
          <CardDescription className="mt-1">
            {rows.length} {rows.length === 1 ? 'document' : 'documents'} for this opportunity
          </CardDescription>
        </div>
        <QuestionFileUploadDialog projectId={projectId} oppId={oppId} />
      </CardHeader>

      <CardContent className="space-y-3">
        {isFilesError && (
          <div className="rounded-xl border bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-900">Failed to load documents</p>
                <p className="text-sm text-red-700 mt-1">
                  {filesError instanceof Error ? filesError.message : 'Unknown error'}
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchFiles()}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        )}

        {downloadError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Download failed: {downloadError.message}</AlertDescription>
          </Alert>
        )}

        {!isFilesError && rows.length === 0 && (
          <div className="text-center py-6">
            <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No solicitation documents yet</p>
            <p className="text-xs text-muted-foreground mt-1">Upload a document to start question extraction.</p>
          </div>
        )}

        {!isFilesError && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((f) => {
              const st = getStatusChip(f.status);
              const isDeleting = !!f.questionFileId && deletingId === f.questionFileId;
              const isDownloading = !!f.questionFileId && downloadingId === f.questionFileId;

              return (
                <div
                  key={f.questionFileId ?? f.name}
                  className={cn(
                    'rounded-xl border bg-background p-3',
                    (isDeleting || isDownloading) && 'opacity-80',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate text-sm" title={f.name}>{f.name}</p>
                        <Badge variant="outline" className={cn('text-xs border', st.cls)}>{st.label}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(f.createdAt)}
                        {f.updatedAt && f.updatedAt !== f.createdAt ? ` • Updated: ${formatDateTime(f.updatedAt)}` : ''}
                      </div>
                      {f.errorMessage && (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                          {f.errorMessage}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {f.fileKey && (
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={isDownloading} onClick={() => void handleDownload(f)} title="Download">
                          {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        </Button>
                      )}

                      {f.status !== 'PROCESSED' && f.status !== 'FAILED' && f.status !== 'DELETED' && (
                        <CancelPipelineButton
                          projectId={projectId}
                          opportunityId={oppId}
                          questionFileId={f.questionFileId}
                          status={f.status}
                          onMutate={refetchFiles}
                        />
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {f.fileKey && (
                            <DropdownMenuItem disabled={isDownloading} onClick={() => void handleDownload(f)}>
                              <Download className="h-4 w-4 mr-2" /> Download
                            </DropdownMenuItem>
                          )}
                          {(f.status === 'PROCESSED' || f.status === 'FAILED') && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600"
                                disabled={!f.questionFileId || isDeleting}
                                onClick={() => void handleDelete(f)}
                              >
                                {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </CardContent>
    </Card>
  );
}