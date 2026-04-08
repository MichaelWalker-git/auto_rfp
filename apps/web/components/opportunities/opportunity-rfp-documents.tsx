'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Download,
  FileDown,
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
} from '@/lib/hooks/use-rfp-documents';
import { RFPDocumentUploadDialog } from '@/components/rfp-documents/rfp-document-upload-dialog';
import { RFPDocumentPreviewDialog } from '@/components/rfp-documents/rfp-document-preview-dialog';
import { RFPDocumentExportDialog } from '@/components/rfp-documents/rfp-document-export-dialog';
import { ExportAllDialog } from '@/components/rfp-documents/export-all-dialog';
import { GoogleDriveSyncButton } from '@/components/rfp-documents/google-drive-sync-button';
import { GenerateDocumentDialog } from '@/components/rfp-documents/generate-document-dialog';
import { getDocumentTypeStyle } from '@/components/rfp-documents/rfp-document-utils';
import { useGetExecutiveBriefByProject } from '@/lib/hooks/use-executive-brief';
import { useGenerateRFPDocument } from '@/lib/hooks/use-rfp-documents';
import type { RequiredOutputDocument } from '@auto-rfp/core';
import { useOpportunityContext } from './opportunity-context';
import { formatDateTime } from './opportunity-helpers';
import Link from 'next/link';
import { useCurrentOrganization } from '@/context/organization-context';
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

export function OpportunityRFPDocuments() {
  const { projectId, oppId, orgId, opportunity } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id ?? orgId;
  const { documents, isLoading, mutate } = useRFPDocuments(projectId, orgId, oppId);
  const { trigger: fetchBrief, data: briefData } = useGetExecutiveBriefByProject(orgId);

  // Fetch brief on mount to get required documents
  React.useEffect(() => {
    if (projectId && oppId) {
      fetchBrief({ projectId, opportunityId: oppId }).catch(() => { /* brief may not exist yet */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, oppId]);

  const briefSections = (briefData?.brief as Record<string, unknown> | undefined)?.sections as Record<string, unknown> | undefined;
  const requirementsSection = briefSections?.requirements as Record<string, unknown> | undefined;
  const requirementsData = requirementsSection?.data as Record<string, unknown> | undefined;
  const submissionCompliance = requirementsData?.submissionCompliance as Record<string, unknown> | undefined;
  const requiredDocuments = (submissionCompliance?.requiredDocuments ?? []) as RequiredOutputDocument[];
  const { trigger: deleteDocument } = useDeleteRFPDocument(orgId);
  const { trigger: getPreviewUrl } = useDocumentPreviewUrl(orgId);
  const { trigger: getDownloadUrl } = useDocumentDownloadUrl(orgId);
  const { trigger: convertToContent } = useConvertToContent(orgId);
  const { trigger: generateDocument } = useGenerateRFPDocument(orgId);
  const { toast } = useToast();
  const [isGeneratingRequired, setIsGeneratingRequired] = useState(false);

  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [exportAllDialogOpen, setExportAllDialogOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<RFPDocumentItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportDoc, setExportDoc] = useState<RFPDocumentItem | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { confirm, ConfirmDialog } = useConfirmDialog();

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

  // Required docs from brief that haven't been generated yet
  const existingDocTypes = useMemo(() => new Set(documents.map((d) => d.documentType)), [documents]);
  const pendingRequiredDocs = useMemo(
    () => requiredDocuments.filter((d) => !existingDocTypes.has(d.documentType)),
    [requiredDocuments, existingDocTypes],
  );

  const handleGenerateRequired = useCallback(async () => {
    if (isGeneratingRequired || pendingRequiredDocs.length === 0) return;
    setIsGeneratingRequired(true);
    try {
      await Promise.all(
        pendingRequiredDocs.map((doc) =>
          generateDocument({ projectId, opportunityId: oppId, documentType: doc.documentType }),
        ),
      );
      await mutate();
      toast({ title: 'Generation started', description: `${pendingRequiredDocs.length} required documents queued.` });
    } catch (err) {
      toast({ title: 'Generation failed', description: err instanceof Error ? err.message : 'Failed', variant: 'destructive' });
    } finally {
      setIsGeneratingRequired(false);
    }
  }, [isGeneratingRequired, pendingRequiredDocs, generateDocument, projectId, oppId, mutate, toast]);

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
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-sm font-medium">RFP Documents</CardTitle>
            <CardDescription className="mt-1">
              {documents.length} {documents.length === 1 ? 'document' : 'documents'} for this opportunity
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
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
              Export All
            </Button>
            {pendingRequiredDocs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateRequired}
                disabled={isGeneratingRequired}
              >
                {isGeneratingRequired ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                {isGeneratingRequired ? 'Generating…' : `Generate Required (${pendingRequiredDocs.length})`}
              </Button>
            )}
            <GenerateDocumentDialog
              projectId={projectId}
              opportunityId={oppId}
              orgId={orgId}
              onSuccess={() => mutate()}
            />
            <Button size="sm" onClick={() => setUploadDialogOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </Button>
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

                const canEdit = doc.content && doc.status !== 'GENERATING' && navOrgId;
                const canConvert = !doc.content && doc.fileKey && (doc.mimeType?.includes('word') || doc.mimeType?.includes('text') || doc.mimeType?.includes('pdf') || doc.fileKey?.endsWith('.docx') || doc.fileKey?.endsWith('.pdf') || doc.fileKey?.endsWith('.txt') || doc.fileKey?.endsWith('.md'));
                
                const cardClassName = cn(
                  'rounded-xl border bg-background p-3',
                  canEdit && 'block hover:bg-muted/50 transition-colors cursor-pointer',
                  (isDeleting || isDownloading) && 'opacity-80',
                );

                const cardContent = (
                  <div className="flex items-start gap-3" data-doc-status={doc.status ?? 'COMPLETE'}>
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate text-sm" title={doc.name}>
                          {doc.name}
                        </p>
                        <Badge variant="outline" className={cn('text-xs border', typeChip.cls)}>
                          {RFP_DOCUMENT_TYPES[doc.documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? doc.documentType}
                        </Badge>
                        <DocumentApprovalStatus 
                          doc={doc} 
                          orgId={orgId} 
                          projectId={projectId} 
                        />
                      </div>

                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {doc.fileSizeBytes > 0 && <span>{formatFileSize(doc.fileSizeBytes)}</span>}
                        <span>{formatDateTime(doc.createdAt)}</span>
                        {doc.createdByName && <span>by {doc.createdByName}</span>}
                        {doc.updatedBy && doc.updatedBy !== doc.createdBy && doc.updatedByName && (
                          <span>• edited by {doc.updatedByName}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {canConvert && (
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={convertingId === doc.documentId} onClick={() => handleConvertAndEdit(doc)} title="Convert & Edit">
                          {convertingId === doc.documentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                        </Button>
                      )}
                      <GoogleDriveSyncButton
                        document={doc}
                        orgId={orgId}
                        onSyncComplete={() => mutate()}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {doc.content && navOrgId && (
                            <DropdownMenuItem asChild>
                              <Link href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/rfp-documents/${doc.documentId}/edit`} className="flex items-center">
                                <Pencil className="h-4 w-4 mr-2" /> Edit Content
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {!doc.content && doc.fileKey && (
                            <DropdownMenuItem disabled={convertingId === doc.documentId} onClick={() => handleConvertAndEdit(doc)}>
                              <Pencil className="h-4 w-4 mr-2" /> Convert & Edit
                            </DropdownMenuItem>
                          )}
                          {doc.content && (
                            <DropdownMenuItem onClick={() => setExportDoc(doc)}>
                              <FileDown className="h-4 w-4 mr-2" /> Export
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