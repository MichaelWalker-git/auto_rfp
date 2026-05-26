'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PermissionButton } from '@/components/ui/permission-button';
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
import { useToast } from '@/components/ui/use-toast';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  type RFPDocumentItem,
  RFP_DOCUMENT_TYPES,
  useRFPDocuments,
  useDeleteRFPDocument,
  useDocumentDownloadUrl,
  useDocumentPreviewUrl,
  useConvertToContent,
  useGenerateRFPDocument,
} from '@/lib/hooks/use-rfp-documents';
import { MAX_GENERATION_RETRIES } from '@auto-rfp/core';
import { RFPDocumentUploadDialog } from '@/components/rfp-documents/rfp-document-upload-dialog';
import { RFPDocumentPreviewDialog } from '@/components/rfp-documents/rfp-document-preview-dialog';
import { RFPDocumentExportDialog } from '@/components/rfp-documents/rfp-document-export-dialog';
import { ExportAllDialog } from '@/components/rfp-documents/export-all-dialog';
import { GoogleDriveSyncButton } from '@/components/rfp-documents/google-drive-sync-button';
import { GenerateDocumentDialog } from '@/components/rfp-documents/generate-document-dialog';
import { getDocumentTypeStyle } from '@/components/rfp-documents/rfp-document-utils';
import { useOpportunityContext } from './opportunity-context';
import { formatDateTime } from './opportunity-helpers';
import Link from 'next/link';
import { useCurrentOrganization } from '@/context/organization-context';

const getDocIcon = (doc: RFPDocumentItem) => {
  if (doc.documentType === 'QUESTIONNAIRE' || doc.mimeType?.includes('spreadsheet') || doc.mimeType?.includes('excel')) {
    return FileSpreadsheet;
  }
  return FileText;
};
import { useApprovalHistory } from '@/features/document-approval';
import { ApprovalStatusBadge } from '@/features/document-approval';


function formatFileSize(bytes: number): string {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Component to show approval status for a document
function DocumentApprovalStatus({ doc, orgId, projectId }: { doc: RFPDocumentItem; orgId: string; projectId: string }) {
  const { activeApproval, hasPendingApproval, approvals } = useApprovalHistory(
    orgId, projectId, doc.opportunityId, doc.documentId,
  );
  
  const isApproved = approvals.length > 0 && approvals[0]?.status === 'APPROVED';
  const isRejected = approvals.length > 0 && approvals[0]?.status === 'REJECTED';
  
  if (isApproved) {
    return <ApprovalStatusBadge status="APPROVED" />;
  }
  
  if (hasPendingApproval) {
    return <ApprovalStatusBadge status="PENDING" />;
  }
  
  if (isRejected) {
    return (
      <Badge variant="outline" className="text-xs border-red-300 text-red-700 bg-red-50">
        Rejected
      </Badge>
    );
  }
  
  return null;
}

// Component to show generation status (GENERATING, RETRYING, FAILED)
function DocumentGenerationStatus({ doc, isRequestingRetry }: { doc: RFPDocumentItem; isRequestingRetry?: boolean }) {
  // Show "Requesting retry..." when user has clicked retry but API hasn't responded yet
  if (isRequestingRetry) {
    return (
      <Badge variant="outline" className="text-xs border border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5 animate-pulse">
        <Loader2 className="h-3 w-3 mr-1 animate-spin inline" />
        Requesting retry...
      </Badge>
    );
  }

  if (doc.status === 'GENERATING') {
    return (
      <Badge variant="outline" className="text-xs border border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5 animate-pulse">
        ⏳ Generating...
      </Badge>
    );
  }
  
  if (doc.status === 'RETRYING') {
    const retryCount = doc.retryCount ?? 0;
    // Display current attempt number (retryCount is 1-indexed during retries)
    // MAX_GENERATION_RETRIES = 3 means: initial + retry 1 + retry 2 = 3 total attempts
    const attemptDisplay = retryCount + 1; // +1 to show which attempt is in progress
    return (
      <Badge 
        variant="outline" 
        className="text-xs border border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5 animate-pulse"
        title={`Attempt ${attemptDisplay} of ${MAX_GENERATION_RETRIES} total attempts`}
      >
        🔄 Retrying (attempt {attemptDisplay}/{MAX_GENERATION_RETRIES})...
      </Badge>
    );
  }
  
  if (doc.status === 'FAILED') {
    return (
      <Badge variant="outline" className="text-xs border border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5">
        ❌ Failed
      </Badge>
    );
  }
  
  return null;
}

export function OpportunityRFPDocuments() {
  const { projectId, oppId, orgId, opportunity } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id ?? orgId;
  const { documents, isLoading, mutate } = useRFPDocuments(projectId, orgId, oppId);
  const { trigger: deleteDocument } = useDeleteRFPDocument(orgId);
  const { trigger: getPreviewUrl } = useDocumentPreviewUrl(orgId);
  const { trigger: getDownloadUrl } = useDocumentDownloadUrl(orgId);
  const { trigger: convertToContent } = useConvertToContent(orgId);
  const { toast } = useToast();

  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [exportAllDialogOpen, setExportAllDialogOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<RFPDocumentItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportDoc, setExportDoc] = useState<RFPDocumentItem | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { trigger: regenerateDocument } = useGenerateRFPDocument(orgId);

  // Determine if there are exportable documents (those with content, not generating)
  const hasExportableDocuments = useMemo(
    () =>
      documents.some(
        (doc) =>
          doc.status !== 'GENERATING' &&
          (doc.htmlContentKey || doc.content),
      ),
    [documents],
  );

  const handlePreview = useCallback(async (doc: RFPDocumentItem) => {
    try {
      setPreviewLoading(true);
      const result = await getPreviewUrl({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      setPreviewUrl(result.url);
      setPreviewDoc(doc);
    } catch (err) {
      toast({ title: 'Preview failed', description: err instanceof Error ? err.message : 'Could not generate preview URL', variant: 'destructive' });
    } finally {
      setPreviewLoading(false);
    }
  }, [getPreviewUrl, toast]);

  const handleDownload = useCallback(async (doc: RFPDocumentItem) => {
    if (downloadingId === doc.documentId) return;
    try {
      setDownloadingId(doc.documentId);
      const result = await getDownloadUrl({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      const a = document.createElement('a');
      a.href = result.url;
      a.download = doc.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      toast({ title: 'Download failed', description: err instanceof Error ? err.message : 'Could not download', variant: 'destructive' });
    } finally {
      setDownloadingId(null);
    }
  }, [downloadingId, getDownloadUrl, toast]);

  const handleConvertAndEdit = useCallback(async (doc: RFPDocumentItem) => {
    if (convertingId === doc.documentId) return;
    try {
      setConvertingId(doc.documentId);
      await convertToContent({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      await mutate();
      // After conversion, the document will have content — open the edit dialog
      // We need to get the updated document from the refreshed list
      toast({ title: 'Document converted', description: 'You can now edit the content. Click "Edit" to open the editor.' });
    } catch (err) {
      toast({ title: 'Conversion failed', description: err instanceof Error ? err.message : 'Could not convert document', variant: 'destructive' });
    } finally {
      setConvertingId(null);
    }
  }, [convertingId, convertToContent, mutate, toast]);

  const handleDelete = useCallback(async (doc: RFPDocumentItem) => {
    if (deletingId === doc.documentId) return;
    const ok = await confirm({
      title: `Delete "${doc.name}"?`,
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      setDeletingId(doc.documentId);
      await deleteDocument({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      toast({ title: 'Document deleted', description: `"${doc.name}" has been removed.` });
      await mutate();
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : 'Could not delete', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, deleteDocument, toast, mutate]);

  const handleRetry = useCallback(async (doc: RFPDocumentItem) => {
    if (retryingId === doc.documentId) return;
    try {
      setRetryingId(doc.documentId);
      await regenerateDocument({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentType: doc.documentType,
        documentId: doc.documentId,
      });
      toast({
        title: 'Regenerating document',
        description: `"${doc.name}" is being regenerated. This may take a few minutes.`,
      });
      await mutate();
    } catch (err) {
      toast({
        title: 'Retry failed',
        description: err instanceof Error ? err.message : 'Could not start document regeneration',
        variant: 'destructive',
      });
    } finally {
      setRetryingId(null);
    }
  }, [retryingId, regenerateDocument, toast, mutate]);

  // Compute available types and filtered documents
  const availableTypes = useMemo(() => {
    const typeCounts = new Map<string, number>();
    for (const doc of documents) {
      const t = doc.documentType;
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    return typeCounts;
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    if (selectedType === 'ALL') return documents;
    return documents.filter((doc) => doc.documentType === selectedType);
  }, [documents, selectedType]);

  if (isLoading && documents.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">RFP Documents</CardTitle>
          <Skeleton className="h-8 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium">RFP Documents</CardTitle>
              <CardDescription className="mt-1">
                {documents.length} {documents.length === 1 ? 'document' : 'documents'} for this opportunity
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExportAllDialogOpen(true)}
                disabled={!hasExportableDocuments || documents.length === 0}
                title={
                  documents.length === 0
                    ? 'No documents to export'
                    : !hasExportableDocuments
                      ? 'No documents with generated content to export'
                      : 'Export all documents as a ZIP bundle'
                }
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <GenerateDocumentDialog
                projectId={projectId}
                opportunityId={oppId}
                orgId={orgId}
                onSuccess={() => mutate()}
              />
              <PermissionButton 
                size="sm" 
                requiredPermission="rfp_document:upload"
                onClick={() => setUploadDialogOpen(true)}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </PermissionButton>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Type filter */}
          {documents.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={selectedType === 'ALL' ? 'default' : 'outline'}
                className="h-7 text-xs rounded-full px-3"
                onClick={() => setSelectedType('ALL')}
              >
                All ({documents.length})
              </Button>
              {Array.from(availableTypes.entries()).map(([type, count]) => {
                const chip = getDocumentTypeStyle(type);
                const isSelected = selectedType === type;
                return (
                  <Button
                    key={type}
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    className={cn('h-7 text-xs rounded-full px-3', !isSelected && chip.cls)}
                    onClick={() => setSelectedType(type)}
                  >
                    {RFP_DOCUMENT_TYPES[type as keyof typeof RFP_DOCUMENT_TYPES] ?? type} ({count})
                  </Button>
                );
              })}
            </div>
          )}

          {documents.length === 0 ? (
            <div className="text-center py-6">
              <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">No RFP documents yet</p>
              <p className="text-xs text-muted-foreground mb-4">
                Generate a proposal from AI or upload documents for this opportunity.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredDocuments.length === 0 && selectedType !== 'ALL' ? (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    No {RFP_DOCUMENT_TYPES[selectedType as keyof typeof RFP_DOCUMENT_TYPES] ?? selectedType} documents.
                  </p>
                </div>
              ) : filteredDocuments.map((doc) => {
                const typeChip = getDocumentTypeStyle(doc.documentType);
                const isDeleting = deletingId === doc.documentId;
                const isDownloading = downloadingId === doc.documentId;

                const canEdit = (doc.content || doc.documentType === 'QUESTIONNAIRE') && doc.status !== 'GENERATING' && doc.status !== 'FAILED' && navOrgId;
                const canConvert = !doc.content && doc.fileKey && (doc.mimeType?.includes('word') || doc.mimeType?.includes('text') || doc.mimeType?.includes('pdf') || doc.fileKey?.endsWith('.docx') || doc.fileKey?.endsWith('.pdf') || doc.fileKey?.endsWith('.txt') || doc.fileKey?.endsWith('.md'));
                
                const cardClassName = cn(
                  'rounded-xl border bg-background p-3',
                  canEdit && 'block hover:bg-muted/50 transition-colors cursor-pointer',
                  (isDeleting || isDownloading) && 'opacity-80',
                );

                const DocIcon = getDocIcon(doc);
                const cardContent = (
                  <>
                  <div className="flex items-start gap-3" data-doc-status={doc.status ?? 'READY'}>
                    <div className="h-10 w-10 rounded-lg bg-muted hidden sm:flex items-center justify-center shrink-0">
                      <DocIcon className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate text-sm" title={doc.name}>
                          {doc.name}
                        </p>
                        <DocumentGenerationStatus doc={doc} isRequestingRetry={retryingId === doc.documentId} />
                        <DocumentApprovalStatus
                          doc={doc}
                          orgId={orgId}
                          projectId={projectId}
                        />
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span className={cn('font-medium', typeChip.cls.replace(/bg-\S+/g, '').replace(/border-\S+/g, '').trim())}>
                          {RFP_DOCUMENT_TYPES[doc.documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? doc.documentType}
                        </span>
                        <span>·</span>
                        {doc.fileSizeBytes > 0 && <><span>{formatFileSize(doc.fileSizeBytes)}</span><span>·</span></>}
                        <span>{formatDateTime(doc.createdAt)}</span>
                        {doc.createdByName && <><span>·</span><span>by {doc.createdByName}</span></>}
                        {doc.updatedBy && doc.updatedBy !== doc.createdBy && doc.updatedByName && (
                          <><span>·</span><span>edited by {doc.updatedByName}</span></>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {canConvert && (
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={convertingId === doc.documentId} onClick={() => handleConvertAndEdit(doc)} title="Convert & Edit">
                          {convertingId === doc.documentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                        </Button>
                      )}
                      {doc.status !== 'FAILED' && (
                        <GoogleDriveSyncButton
                          document={doc}
                          orgId={orgId}
                          onSyncComplete={() => mutate()}
                        />
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(doc.content || doc.documentType === 'QUESTIONNAIRE') && doc.status !== 'FAILED' && navOrgId && (
                            <DropdownMenuItem asChild>
                              <Link href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/rfp-documents/${doc.documentId}/edit`} className="flex items-center">
                                <Pencil className="h-4 w-4 mr-2" /> {doc.documentType === 'QUESTIONNAIRE' ? 'Edit Spreadsheet' : 'Edit Content'}
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {!doc.content && doc.documentType !== 'QUESTIONNAIRE' && doc.fileKey && (
                            <DropdownMenuItem disabled={convertingId === doc.documentId} onClick={() => handleConvertAndEdit(doc)}>
                              <Pencil className="h-4 w-4 mr-2" /> Convert & Edit
                            </DropdownMenuItem>
                          )}
                          {doc.content && doc.status !== 'FAILED' && (
                            <DropdownMenuItem onClick={() => setExportDoc(doc)}>
                              <FileDown className="h-4 w-4 mr-2" /> Export
                            </DropdownMenuItem>
                          )}
                          {doc.fileKey && (
                            <DropdownMenuItem disabled={isDownloading} onClick={() => void handleDownload(doc)}>
                              <Download className="h-4 w-4 mr-2" /> Download
                            </DropdownMenuItem>
                          )}
                          {doc.status === 'FAILED' && !doc.fileKey && (
                            <DropdownMenuItem 
                              disabled={retryingId === doc.documentId} 
                              onClick={() => handleRetry(doc)}
                              className="text-amber-600"
                            >
                              {retryingId === doc.documentId ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                              )}
                              Retry Generation
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600" disabled={isDeleting} onClick={() => handleDelete(doc)}>
                            {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {doc.status === 'FAILED' && doc.generationError && (
                    <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                      {doc.generationError}
                    </p>
                  )}
                  </>
                );

                // Use explicit conditional rendering to avoid TypeScript error with dynamic component
                return canEdit ? (
                  <Link
                    key={doc.documentId}
                    href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/rfp-documents/${doc.documentId}/edit`}
                    className={cardClassName}
                  >
                    {cardContent}
                  </Link>
                ) : (
                  <div key={doc.documentId} className={cardClassName}>
                    {cardContent}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <RFPDocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        projectId={projectId}
        orgId={orgId}
        opportunityId={oppId}
        onSuccess={() => mutate()}
      />
      <RFPDocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(open) => { if (!open) { setPreviewDoc(null); setPreviewUrl(null); } }}
        document={previewDoc}
        previewUrl={previewUrl}
      />
      <RFPDocumentExportDialog
        open={!!exportDoc}
        onOpenChange={(open) => { if (!open) setExportDoc(null); }}
        document={exportDoc}
        orgId={orgId}
      />
      <ExportAllDialog
        open={exportAllDialogOpen}
        onOpenChange={setExportAllDialogOpen}
        projectId={projectId}
        orgId={orgId}
        opportunityId={oppId}
        opportunityTitle={opportunity?.title ?? undefined}
        documents={documents}
      />
      <ConfirmDialog />
    </>
  );
}