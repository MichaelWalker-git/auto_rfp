'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Upload, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDeleteDialog } from '@/components/ui/confirm-delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import {
  type RFPDocumentItem,
  useRFPDocuments,
  useDeleteRFPDocument,
  useExportAllRFPDocuments,
} from '@/lib/hooks/use-rfp-documents';
import { RFPDocumentUploadDialog } from './rfp-document-upload-dialog';
import { RFPDocumentExportDialog } from './rfp-document-export-dialog';
import { RFPDocumentCard } from './rfp-document-card';
import { RFPDocumentEmptyState } from './rfp-document-empty-state';
import {
  GenerateRFPDocumentModal,
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/GenerateRFPDocumentModal';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface RFPDocumentsContentProps {
  projectId: string;
  orgId: string;
  opportunityId?: string;
}

export function RFPDocumentsContent({ projectId, orgId, opportunityId }: RFPDocumentsContentProps) {
  const { documents, isLoading, mutate } = useRFPDocuments(projectId, orgId, opportunityId);
  const { trigger: deleteDocument } = useDeleteRFPDocument(orgId);
  const { trigger: exportAll } = useExportAllRFPDocuments(orgId);
  const { toast } = useToast();

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [exportDoc, setExportDoc] = useState<RFPDocumentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<RFPDocumentItem | null>(null);
  const [isExportingAll, setIsExportingAll] = useState(false);

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

  const handleExportAll = useCallback(async () => {
    if (!projectId || isExportingAll) return;

    try {
      setIsExportingAll(true);
      toast({
        title: 'Preparing export…',
        description: 'Bundling all documents as DOCX and PDF. This may take a moment.',
      });

      const result = await exportAll({
        projectId,
        opportunityId: opportunityId || undefined,
        options: { pageSize: 'letter' },
      });

      if (!result?.success || !result?.export?.url) {
        throw new Error('Export failed — no download URL returned.');
      }

      // Trigger download
      const link = document.createElement('a');
      link.href = result.export.url;
      link.download = result.export.fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      const { summary } = result;
      const skippedMsg =
        summary.skippedDocuments > 0
          ? ` (${summary.skippedDocuments} skipped)`
          : '';

      toast({
        title: 'Export complete',
        description: `${summary.exportedDocuments} document${summary.exportedDocuments === 1 ? '' : 's'} exported as DOCX + PDF${skippedMsg}.`,
      });
    } catch (err) {
      console.error('Export all error:', err);
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Failed to export documents',
        variant: 'destructive',
      });
    } finally {
      setIsExportingAll(false);
    }
  }, [projectId, opportunityId, isExportingAll, exportAll, toast]);

  const handleMutate = useCallback(() => { mutate(); }, [mutate]);

  const renderDocumentItem = useCallback(
    (doc: RFPDocumentItem) => (
      <RFPDocumentCard
        key={doc.documentId}
        document={doc}
        orgId={orgId}
        projectId={projectId}
        isDeleting={deletingId === doc.documentId}
        onExport={setExportDoc}
        onDelete={setDeleteConfirmDoc}
        onSyncComplete={handleMutate}
      />
    ),
    [orgId, projectId, deletingId, handleMutate],
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      onClick={handleExportAll}
                      disabled={isExportingAll || !hasExportableDocuments || documents.length === 0}
                    >
                      {isExportingAll ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Exporting…
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export All
                        </>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {documents.length === 0
                    ? 'No documents to export'
                    : !hasExportableDocuments
                      ? 'No documents with generated content to export'
                      : 'Download all documents as a ZIP (DOCX + PDF)'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
