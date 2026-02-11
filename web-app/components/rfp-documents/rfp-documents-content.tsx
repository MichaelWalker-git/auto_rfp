'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Download,
  Eye,
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
import { SignatureStatusBadge } from './signature-status-badge';
import { LinearSyncIndicator } from './linear-sync-indicator';
import { SignatureTrackerDialog } from './signature-tracker-dialog';

interface RFPDocumentsContentProps {
  projectId: string;
  orgId: string;
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

export function RFPDocumentsContent({ projectId, orgId }: RFPDocumentsContentProps) {
  const { documents, isLoading, isError, error, mutate } = useRFPDocuments(projectId, orgId);
  const { trigger: deleteDocument } = useDeleteRFPDocument(orgId);
  const { trigger: getPreviewUrl } = useDocumentPreviewUrl(orgId);
  const { trigger: getDownloadUrl } = useDocumentDownloadUrl(orgId);
  const { toast } = useToast();

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<RFPDocumentItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editDoc, setEditDoc] = useState<RFPDocumentItem | null>(null);
  const [signatureDoc, setSignatureDoc] = useState<RFPDocumentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const handleDelete = useCallback(
    async (doc: RFPDocumentItem) => {
      if (deletingId === doc.documentId) return;
      const ok = window.confirm(`Delete "${doc.name}"? This action cannot be undone.`);
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
        toast({
          title: 'Delete failed',
          description: err instanceof Error ? err.message : 'Could not delete document',
          variant: 'destructive',
        });
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId, deleteDocument, toast, mutate],
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
                <DropdownMenuItem onClick={() => setSignatureDoc(doc)}>
                  <FileText className="h-4 w-4 mr-2" />
                  Signature Status
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={isDeleting}
                  onClick={() => handleDelete(doc)}
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
          <Button onClick={() => setUploadDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Document
          </Button>
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
    </div>
  );
}