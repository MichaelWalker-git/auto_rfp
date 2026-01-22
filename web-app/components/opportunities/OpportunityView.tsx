'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Download, FileText, FolderOpen, Loader2, RefreshCw, Trash2, Tag } from 'lucide-react';

import type { OpportunityItem } from '@auto-rfp/shared';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import PermissionWrapper from '@/components/permission-wrapper';

import { useOpportunity } from '@/lib/hooks/use-opportunities';
import { useQuestionFiles, useDeleteQuestionFile } from '@/lib/hooks/use-question-file';
import { useDownloadFromS3 } from '@/lib/hooks/use-file';

import {
  QuestionFileUploadDialog,
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/question-extraction-dialog';

interface OpportunityViewProps {
  projectId: string;
  oppId: string;
  className?: string;
}

function formatDate(dateString?: string | null) {
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

function pickDisplayName(qf: any): string {
  return (
    qf?.fileName ??
    qf?.originalFileName ??
    (typeof qf?.fileKey === 'string' ? qf.fileKey.split('/').pop() : undefined) ??
    'Unknown file'
  );
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

export function OpportunityView({ projectId, oppId, className }: OpportunityViewProps) {
  const { data: item, isLoading: oppLoading, error: oppError, refetch } = useOpportunity(
    projectId,
    oppId,
  );

  const { items: qItems, isLoading: qLoading, isError: qIsError, error: qError, refetch: refetchQ } = useQuestionFiles(
    projectId,
    { oppId },
  );

  const { downloadFile, error: downloadError } = useDownloadFromS3();
  const { trigger: deleteQuestionFile } = useDeleteQuestionFile();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    return (qItems ?? []).map((qf: any) => ({
      questionFileId: qf?.questionFileId as string | undefined,
      name: pickDisplayName(qf),
      status: qf?.status as string | undefined,
      createdAt: qf?.createdAt as string | undefined,
      updatedAt: qf?.updatedAt as string | undefined,
      fileKey: qf?.fileKey as string | undefined,
      errorMessage: qf?.errorMessage as string | undefined,
    }));
  }, [qItems]);

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
      await deleteQuestionFile({ projectId, oppId, questionFileId: row.questionFileId });
      await refetchQ();
    } finally {
      setDeletingId((prev) => (prev === row.questionFileId ? null : prev));
    }
  };

  const details = item as OpportunityItem | null;

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 truncate">
              <FolderOpen className="h-5 w-5" />
              {oppLoading ? 'Loading opportunity…' : details?.title ?? 'Opportunity'}
            </CardTitle>
            <CardDescription className="truncate">
              {details?.organizationName ?? '—'}
            </CardDescription>

            {details ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary">{details.source}</Badge>
                {details.active ? <Badge>ACTIVE</Badge> : <Badge variant="outline">INACTIVE</Badge>}
                {details.type ? <Badge variant="outline">{details.type}</Badge> : null}
                {details.naicsCode ? (
                  <Badge variant="outline" className="gap-1">
                    <Tag className="h-3.5 w-3.5" />
                    NAICS {details.naicsCode}
                  </Badge>
                ) : null}
                {details.pscCode ? <Badge variant="outline">PSC {details.pscCode}</Badge> : null}
                {details.setAside ? <Badge variant="outline">{details.setAside}</Badge> : null}
                {details.solicitationNumber ? <Badge variant="outline">Solicitation {details.solicitationNumber}</Badge> : null}
                {details.noticeId ? <Badge variant="outline">Notice {details.noticeId}</Badge> : null}
              </div>
            ) : null}

            {details ? (
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Posted: {formatDate(details.postedDateIso)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Due: {formatDate(details.responseDeadlineIso)}
                </span>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={oppLoading}>
              {oppLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {oppLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : oppError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{oppError.message}</AlertDescription>
            </Alert>
          ) : (
            <div className="text-sm leading-6 whitespace-pre-wrap">
              {details?.description ?? <span className="text-muted-foreground">No description available.</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Bottom: Attachments (Question files) card ---------- */}
      {qLoading && qItems.length === 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Attachments
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
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Attachments
              </CardTitle>
              <CardDescription>
                {(qItems?.length ?? 0)} {(qItems?.length ?? 0) === 1 ? 'file' : 'files'} for this opportunity
              </CardDescription>
            </div>

            <QuestionFileUploadDialog projectId={projectId} oppId={oppId} />
          </CardHeader>

          <CardContent className="space-y-3">
            {qIsError ? (
              <div className="rounded-xl border bg-red-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-red-900">Couldn’t load files</p>
                    <p className="text-sm text-red-700 mt-1">
                      {qError instanceof Error ? qError.message : 'Unknown error'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => refetchQ()}>
                        Retry
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {downloadError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Download failed: {downloadError.message}</AlertDescription>
              </Alert>
            ) : null}

            {!qIsError && (qItems?.length ?? 0) === 0 ? (
              <div className="text-center py-10">
                <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground mb-3" />
                <h3 className="text-lg font-medium">No files yet</h3>
                <p className="text-muted-foreground mt-1">Upload a document to start extraction.</p>
              </div>
            ) : null}

            {!qIsError && (qItems?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {rows.map((f) => {
                  const st = statusChip(f.status);

                  const rowDeleting = !!f.questionFileId && deletingId === f.questionFileId;
                  const rowDownloading = !!f.questionFileId && downloadingId === f.questionFileId;

                  return (
                    <div
                      key={f.questionFileId ?? f.name}
                      className={cn(
                        'rounded-xl border bg-background p-3',
                        (rowDeleting || rowDownloading) && 'opacity-80',
                      )}
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

                          {typeof f.fileKey === 'string' && f.fileKey.length > 0 ? (
                            <div className="mt-1 text-xs text-muted-foreground truncate" title={f.fileKey}>
                              Key: {f.fileKey}
                            </div>
                          ) : null}

                          {typeof f.errorMessage === 'string' && f.errorMessage.length > 0 ? (
                            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                              {f.errorMessage}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            disabled={!f.fileKey || rowDownloading}
                            onClick={() =>
                              void handleDownload({
                                questionFileId: f.questionFileId,
                                fileKey: f.fileKey,
                                name: f.name,
                              })
                            }
                            title={!f.fileKey ? 'No file key' : 'Download file'}
                          >
                            {rowDownloading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>

                          <PermissionWrapper requiredPermission={'question:delete'}>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="gap-2"
                              disabled={!f.questionFileId || rowDeleting}
                              onClick={() => void handleDelete({ questionFileId: f.questionFileId, name: f.name })}
                            >
                              {rowDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </PermissionWrapper>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <Separator />

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetchQ()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh files
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}