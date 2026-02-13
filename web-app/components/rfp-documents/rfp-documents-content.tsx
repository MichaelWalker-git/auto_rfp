'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Download,
  Eye,
  FileDown,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import {
  type RFPDocumentItem,
  RFP_DOCUMENT_TYPES,
  useRFPDocuments,
  useDeleteRFPDocument,
  useDocumentDownloadUrl,
  useDocumentPreviewUrl,
} from '@/lib/hooks/use-rfp-documents';
import { RFPDocumentUploadDialog } from './rfp-document-upload-dialog';
import { RFPDocumentPreviewDialog } from './rfp-document-preview-dialog';
import { RFPDocumentEditDialog } from './rfp-document-edit-dialog';
import { RFPDocumentExportDialog } from './rfp-document-export-dialog';
import { SignatureStatusBadge } from './signature-status-badge';
import { LinearSyncIndicator } from './linear-sync-indicator';
import { SignatureTrackerDialog } from './signature-tracker-dialog';
import {
  GenerateProposalModal
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/GenerateProposalModal';

interface RFPDocumentsContentProps {
  projectId: string;
  orgId: string;
  opportunityId?: string;
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function documentTypeChip(type: string) {
  const typeMap: Record<string, { cls: string }> = {
    PROPOSAL: { cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    EXECUTIVE_BRIEF: { cls: 'bg-purple-50 text-purple-700 border-purple-200' },
    TECHNICAL_PROPOSAL: { cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    COST_PROPOSAL: { cls: 'bg-green-50 text-green-700 border-green-200' },
    PAST_PERFORMANCE: { cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    MANAGEMENT_APPROACH: { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    COMPLIANCE_MATRIX: { cls: 'bg-teal-50 text-teal-700 border-teal-200' },
    TEAMING_AGREEMENT: { cls: 'bg-orange-50 text-orange-700 border-orange-200' },
    NDA: { cls: 'bg-red-50 text-red-700 border-red-200' },
    CONTRACT: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    AMENDMENT: { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    CORRESPONDENCE: { cls: 'bg-slate-50 text-slate-700 border-slate-200' },
    OTHER: { cls: 'bg-gray-50 text-gray-700 border-gray-200' },
  };
  return typeMap[type] ?? typeMap.OTHER;
}

export function RFPDocumentsContent({ projectId, orgId, opportunityId }: RFPDocumentsContentProps) {
  const { documents, isLoading, isError, error, mutate } = useRFPDocuments(projectId, orgId, opportunityId);
  const { trigger: deleteDocument } = useDeleteRFPDocument(orgId);
  const { trigger: getPreviewUrl } = useDocumentPreviewUrl(orgId);
  const { trigger: getDownloadUrl } = useDocumentDownloadUrl(orgId);
  const { toast } = useToast();

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<RFPDocumentItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editDoc, setEditDoc] = useState<RFPDocumentItem | null>(null);
  const [signatureDoc, setSignatureDoc] = useState<RFPDocumentItem | null>(null);
  const [exportDoc, setExportDoc] = useState<RFPDocumentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<RFPDocumentItem | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handlePreview = useCallback(
    async (doc: RFPDocumentItem) => {
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
        toast({
          title: 'Preview failed',
          description: err instanceof Error ? err.message : 'Could not generate preview URL',
          variant: 'destructive',
        });
      } finally {
        setPreviewLoading(false);
      }
    },
    [getPreviewUrl, toast],
  );

  const handleDownload = useCallback(
    async (doc: RFPDocumentItem) => {
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
        toast({
          title: 'Download failed',
          description: err instanceof Error ? err.message : 'Could not generate download URL',
          variant: 'destructive',
        });
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, getDownloadUrl, toast],
  );

  const confirmDelete = useCallback(
    async () => {
      const doc = deleteConfirmDoc;
      if (!doc || deletingId === doc.documentId) return;

      try {
        setDeletingId(doc.documentId);
        setDeleteConfirmDoc(null);
        await deleteDocument({
          projectId: doc.projectId,
          opportunityId: doc.opportunityId,
          documentId: doc.documentId,
        });
        toast({ title: 'Document deleted', description: `"${doc.name}" has been removed.` });
        await mutate();
      } catch (err) {
        toast({
          title: 'Delete failed',
          description: err instanceof Error ? err.message : 'Could not delete document',
          variant: 'destructive',
        });
      } finally {
        setDeletingId(null);
      }
    },
    [deleteConfirmDoc, deletingId, deleteDocument, toast, mutate],
  );

  const renderDocumentItem = (doc: RFPDocumentItem) => {
    const typeChip = documentTypeChip(doc.documentType);
    const isDeleting = deletingId === doc.documentId;
    const isDownloading = downloadingId === doc.documentId;

    return (
      <div
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
              <p className="font-medium truncate" title={doc.name}>
                {doc.name}
              </p>
              <Badge variant="outline" className={cn('text-xs border', typeChip.cls)}>
                {RFP_DOCUMENT_TYPES[doc.documentType] ?? doc.documentType}
              </Badge>
              {(doc as any).status === 'GENERATING' ? (
                <Badge variant="outline" className="text-xs border border-amber-500/30 text-amber-600 bg-amber-500/5 animate-pulse">
                  ⏳ Generating...
                </Badge>
              ) : (doc as any).content && !doc.fileKey ? (
                <Badge variant="outline" className="text-xs border border-violet-500/30 text-violet-600 bg-violet-500/5">
                  🤖 AI Generated
                </Badge>
              ) : doc.fileKey ? (
                <Badge variant="outline" className="text-xs border border-blue-500/30 text-blue-600 bg-blue-500/5">
                  📎 Uploaded
                </Badge>
              ) : null}
              {(doc as any).status === 'FAILED' && (
                <Badge variant="outline" className="text-xs border border-red-500/30 text-red-600 bg-red-500/5">
                  ❌ Failed
                </Badge>
              )}
              <SignatureStatusBadge status={doc.signatureStatus} />
              <LinearSyncIndicator status={doc.linearSyncStatus} lastSyncedAt={doc.lastSyncedAt} />
            </div>

            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>v{doc.version}</span>
              <span>{formatFileSize(doc.fileSizeBytes)}</span>
              <span>Uploaded: {formatDate(doc.createdAt)}{doc.createdByName ? ` by ${doc.createdByName}` : ''}</span>
              {doc.updatedAt !== doc.createdAt && (
                <span>Updated: {formatDate(doc.updatedAt)}{doc.updatedByName ? ` by ${doc.updatedByName}` : ''}</span>
              )}
            </div>

            {doc.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {doc.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {doc.fileKey && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={previewLoading}
                onClick={() => handlePreview(doc)}
                title="Preview document"
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}

            {doc.fileKey && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={isDownloading}
                onClick={() => handleDownload(doc)}
                title="Download document"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            )}

            {doc.content && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => setExportDoc(doc)}
                title="Export document"
              >
                <FileDown className="h-4 w-4" />
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditDoc(doc)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Details
                </DropdownMenuItem>
                {doc.content && (
                  <DropdownMenuItem onClick={() => setExportDoc(doc)}>
                    <FileDown className="h-4 w-4 mr-2" />
                    Export
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setSignatureDoc(doc)}>
                  <FileText className="h-4 w-4 mr-2" />
                  Signature Status
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirmDoc(doc)}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    );
  };

  const emptyState = (
    <div className="text-center py-10">
      <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground mb-3" />
      <h3 className="text-lg font-medium">No RFP documents yet</h3>
      <p className="text-muted-foreground mt-1">
        Upload documents developed during the RFP process such as technical proposals, cost
        proposals, teaming agreements, and more.
      </p>
      <Button className="mt-4" onClick={() => setUploadDialogOpen(true)}>
        <Upload className="h-4 w-4 mr-2" />
        Upload Your First Document
      </Button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <ListingPageLayout
        title="RFP Documents"
        description={`${documents.length} ${documents.length === 1 ? 'document' : 'documents'} in this project`}
        headerActions={
          <div className="flex items-center gap-2">
            {opportunityId && (
              <GenerateProposalModal
                projectId={projectId}
                opportunityId={opportunityId}
                onSave={() => mutate()}
              />
            )}
            <Button onClick={() => setUploadDialogOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </Button>
          </div>
        }
        isLoading={isLoading}
        isEmpty={documents.length === 0}
        emptyState={emptyState}
        data={documents}
        renderItem={renderDocumentItem}
        onReload={async () => {
          await mutate();
        }}
      />

      {/* Dialogs */}
      <RFPDocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        projectId={projectId}
        orgId={orgId}
        onSuccess={() => mutate()}
      />

      <RFPDocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewDoc(null);
            setPreviewUrl(null);
          }
        }}
        document={previewDoc}
        previewUrl={previewUrl}
      />

      <RFPDocumentEditDialog
        open={!!editDoc}
        onOpenChange={(open) => {
          if (!open) setEditDoc(null);
        }}
        document={editDoc}
        orgId={orgId}
        onSuccess={() => mutate()}
      />

      <SignatureTrackerDialog
        open={!!signatureDoc}
        onOpenChange={(open) => {
          if (!open) setSignatureDoc(null);
        }}
        document={signatureDoc}
        orgId={orgId}
        onSuccess={() => mutate()}
      />

      <RFPDocumentExportDialog
        open={!!exportDoc}
        onOpenChange={(open) => {
          if (!open) setExportDoc(null);
        }}
        document={exportDoc}
        orgId={orgId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmDoc} onOpenChange={(open) => { if (!open) setDeleteConfirmDoc(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>&quot;{deleteConfirmDoc?.name}&quot;</strong>?
              This action cannot be undone and the document will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deletingId ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
