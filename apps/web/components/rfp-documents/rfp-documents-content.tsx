'use client';

import React, { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDeleteDialog } from '@/components/ui/confirm-delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import {
  type RFPDocumentItem,
  useRFPDocuments,
  useDeleteRFPDocument,
  useDocumentDownloadUrl,
  useDocumentPreviewUrl,
} from '@/lib/hooks/use-rfp-documents';
import { RFPDocumentUploadDialog } from './rfp-document-upload-dialog';
import { RFPDocumentPreviewDialog } from './rfp-document-preview-dialog';
import { RFPDocumentEditDialog } from './rfp-document-edit-dialog';
import { RFPDocumentExportDialog } from './rfp-document-export-dialog';
import { SignatureTrackerDialog } from './signature-tracker-dialog';
import { RFPDocumentCard } from './rfp-document-card';
import { RFPDocumentEmptyState } from './rfp-document-empty-state';
import {
  GenerateRFPDocumentModal,
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/GenerateRFPDocumentModal';

interface RFPDocumentsContentProps {
  projectId: string;
  orgId: string;
  opportunityId?: string;
}

export function RFPDocumentsContent({ projectId, orgId, opportunityId }: RFPDocumentsContentProps) {
  const { documents, isLoading, mutate } = useRFPDocuments(projectId, orgId, opportunityId);
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

  const confirmDelete = useCallback(async () => {
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
  }, [deleteConfirmDoc, deletingId, deleteDocument, toast, mutate]);

  const handleMutate = useCallback(() => { mutate(); }, [mutate]);

  const renderDocumentItem = useCallback(
    (doc: RFPDocumentItem) => (
      <RFPDocumentCard
        key={doc.documentId}
        document={doc}
        orgId={orgId}
        isDeleting={deletingId === doc.documentId}
        isDownloading={downloadingId === doc.documentId}
        isPreviewLoading={previewLoading}
        onPreview={handlePreview}
        onDownload={handleDownload}
        onEdit={setEditDoc}
        onExport={setExportDoc}
        onSignature={setSignatureDoc}
        onDelete={setDeleteConfirmDoc}
        onSyncComplete={handleMutate}
      />
    ),
    [orgId, deletingId, downloadingId, previewLoading, handlePreview, handleDownload, handleMutate],
  );

  return (
    <div className="container mx-auto p-12">
      <ListingPageLayout
        title="RFP Documents"
        description={`${documents.length} ${documents.length === 1 ? 'document' : 'documents'} in this project`}
        headerActions={
          <div className="flex items-center gap-2">
            {opportunityId && (
              <GenerateRFPDocumentModal
                projectId={projectId}
                opportunityId={opportunityId}
                onSave={handleMutate}
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
        emptyState={<RFPDocumentEmptyState onUpload={() => setUploadDialogOpen(true)} />}
        data={documents}
        renderItem={renderDocumentItem}
        onReload={async () => { await mutate(); }}
      />

      <RFPDocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        projectId={projectId}
        orgId={orgId}
        onSuccess={handleMutate}
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
        onSuccess={handleMutate}
      />

      <SignatureTrackerDialog
        open={!!signatureDoc}
        onOpenChange={(open) => {
          if (!open) setSignatureDoc(null);
        }}
        document={signatureDoc}
        orgId={orgId}
        onSuccess={handleMutate}
      />

      <RFPDocumentExportDialog
        open={!!exportDoc}
        onOpenChange={(open) => {
          if (!open) setExportDoc(null);
        }}
        document={exportDoc}
        orgId={orgId}
      />

      <ConfirmDeleteDialog
        isOpen={!!deleteConfirmDoc}
        onOpenChange={(open) => { if (!open) setDeleteConfirmDoc(null); }}
        itemName={deleteConfirmDoc?.name}
        itemType="document"
        description="This action cannot be undone and the document will be permanently removed."
        onConfirm={confirmDelete}
      />
    </div>
  );
}
