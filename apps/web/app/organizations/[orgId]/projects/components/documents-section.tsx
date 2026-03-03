'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useDeleteQuestionFile, useQuestionFiles } from '@/lib/hooks/use-question-file';
import { useDownloadFromS3 } from '@/lib/hooks/use-file';
import PermissionWrapper from '@/components/permission-wrapper';
import {
  QuestionFileUploadDialog,
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/question-extraction-dialog';
import { CancelPipelineButton } from '@/components/cancel-pipeline-button';
import {
  NoRfpDocumentAvailable,
  useQuestions,
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';
import {
  AlertCircle,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { formatDateTime, getStatusChip, pickDisplayName } from '@/components/opportunities/opportunity-helpers';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

interface Props {
  projectId?: string;
}

interface DocumentRow {
  questionFileId?: string;
  name: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  fileKey?: string;
  errorMessage?: string;
  textFileKey?: string;
  oppId?: string;
  projectId?: string;
}

export function DocumentsSection({ projectId: propProjectId }: Props) {
  const searchParams = useSearchParams();
  const projectId = propProjectId || searchParams.get('projectId');
  const { questions, isLoading: questionsLoading, error: questionsError } = useQuestions();
  const { items, isLoading, isError, error, refetch } = useQuestionFiles(projectId || '');
  const { trigger: deleteQuestionFile } = useDeleteQuestionFile();
  const { downloadFile, error: downloadError } = useDownloadFromS3();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const rows: DocumentRow[] = useMemo(() => {
    return (items ?? []).map((qf: any) => ({
      questionFileId: qf?.questionFileId as string | undefined,
      name: pickDisplayName(qf),
      status: qf?.status as string | undefined,
      createdAt: qf?.createdAt as string | undefined,
      updatedAt: qf?.updatedAt as string | undefined,
      fileKey: qf?.fileKey as string | undefined,
      errorMessage: qf?.errorMessage as string | undefined,
      textFileKey: qf?.textFileKey as string | undefined,
      oppId: qf?.oppId as string | undefined,
      projectId: qf?.projectId as string | undefined,
    }));
  }, [items]);

  const handleDownload = useCallback(
    async (row: DocumentRow) => {
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
    async (row: DocumentRow) => {
      const { questionFileId, oppId, name } = row;
      if (!questionFileId || !projectId || !oppId) return;
      if (deletingId === questionFileId) return;

      const ok = await confirm({
        title: `Delete "${name}"?`,
        description: 'This action cannot be undone.',
        confirmLabel: 'Delete',
        variant: 'destructive',
      });
      if (!ok) return;

      try {
        setDeletingId(questionFileId);
        await deleteQuestionFile({ projectId, questionFileId, oppId });
        await refetch();
      } finally {
        setDeletingId((prev) => (prev === questionFileId ? null : prev));
      }
    },
    [projectId, deletingId, deleteQuestionFile, refetch],
  );

  if (!projectId) {
    return (
      <div className="container mx-auto p-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Solicitation Documents</CardTitle>
            <CardDescription>Upload and manage solicitation documents for question extraction.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <p className="text-muted-foreground">No project selected</p>
            </div>
          </CardContent>
        </Card>
        <ConfirmDialog />
      </div>
    );
  }

  if (!questionsLoading && !questionsError && !questions) {
    return (
      <div className="container mx-auto p-12">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Solicitation Documents</CardTitle>
              <CardDescription className="mt-1">
                Upload and manage solicitation documents for question extraction.
              </CardDescription>
            </div>
            <QuestionFileUploadDialog projectId={projectId} />
          </CardHeader>
          <CardContent>
            <NoRfpDocumentAvailable projectId={projectId} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading skeleton
  if (isLoading && rows.length === 0) {
    return (
      <div className="container mx-auto p-12">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Solicitation Documents</CardTitle>
            <Skeleton className="h-8 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-12">
      <PageHeader
        title="Solicitation Documents"
        description={`${rows.length} ${rows.length === 1 ? 'document' : 'documents'} in this project`}
        actions={<QuestionFileUploadDialog projectId={projectId} />}
      />

      {downloadError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Download failed: {downloadError.message}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardContent className="space-y-3">
          {isError && (
            <div className="rounded-xl border bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-red-900">Failed to load documents</p>
                  <p className="text-sm text-red-700 mt-1">
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!isError && rows.length === 0 && (
            <div className="text-center py-6">
              <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No solicitation documents yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Upload a document to start question extraction.
              </p>
            </div>
          )}

          {!isError && rows.length > 0 && (
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
                          <p className="font-medium truncate text-sm" title={f.name}>
                            {f.name}
                          </p>
                          <Badge variant="outline" className={cn('text-xs border', st.cls)}>
                            {st.label}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(f.createdAt)}
                          {f.updatedAt && f.updatedAt !== f.createdAt
                            ? ` • Updated: ${formatDateTime(f.updatedAt)}`
                            : ''}
                        </div>
                        {f.errorMessage && (
                          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                            {f.errorMessage}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {f.fileKey && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            disabled={isDownloading}
                            onClick={() => void handleDownload(f)}
                            title="Download"
                          >
                            {isDownloading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        )}

                        {f.status !== 'PROCESSED' &&
                          f.status !== 'FAILED' &&
                          f.status !== 'DELETED' && (
                            <CancelPipelineButton
                              projectId={f.projectId}
                              opportunityId={f.oppId}
                              questionFileId={f.questionFileId}
                              status={f.status}
                              onMutate={refetch}
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
                              <DropdownMenuItem
                                disabled={isDownloading}
                                onClick={() => void handleDownload(f)}
                              >
                                <Download className="h-4 w-4 mr-2" /> Download
                              </DropdownMenuItem>
                            )}
                            {(f.status === 'PROCESSED' || f.status === 'FAILED') && (
                              <>
                                <DropdownMenuSeparator />
                                <PermissionWrapper requiredPermission="question:delete">
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    disabled={!f.questionFileId || isDeleting}
                                    onClick={() => void handleDelete(f)}
                                  >
                                    {isDeleting ? (
                                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4 mr-2" />
                                    )}
                                    Delete
                                  </DropdownMenuItem>
                                </PermissionWrapper>
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
      <ConfirmDialog />
    </div>
  );
}
