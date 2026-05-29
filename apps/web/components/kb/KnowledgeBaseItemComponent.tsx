'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { PageSearch } from '@/components/layout/page-search';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, FileText, PlusCircle, Shield, ShieldAlert, Upload } from 'lucide-react';
import PermissionWrapper from '@/components/permission-wrapper';

import { useKnowledgeBase } from '@/lib/hooks/use-knowledgebase';
import {
  useCreateDocument,
  useDeleteDocument,
  useDocumentsByKb,
  useDownloadDocument,
  useStartDocumentPipeline,
} from '@/lib/hooks/use-document';
import { useAuth } from '@/components/AuthProvider';
import { DocumentItem } from '@auto-rfp/core';

import { useDocumentUpload } from './hooks/useDocumentUpload';
import { DocumentCard } from './components/DocumentCard';
import { UploadDialog } from './components/UploadDialog';
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog';

export default function KnowledgeBaseItemComponent() {
  const { orgId, kbId } = useParams<{ orgId: string; kbId: string }>();
  const { data: kb, isLoading: kbLoading, error: kbError } = useKnowledgeBase(kbId, orgId);
  const { data: documents, isLoading: docsLoading, mutate: refreshDocuments } = useDocumentsByKb(kbId);
  const { trigger: createDocument } = useCreateDocument();
  const { trigger: startPipeline } = useStartDocumentPipeline();
  const { trigger: deleteDocument, isMutating: isDeleting } = useDeleteDocument();
  const { trigger: downloadDocument, isMutating: isDownloading, error: downloadError } = useDownloadDocument();
  const { userSub } = useAuth();

  const [showUpload, setShowUpload] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [docToDelete, setDocToDelete] = useState<DocumentItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const uploadHook = useDocumentUpload({
    kbId,
    orgId,
    createDocument,
    startPipeline,
    onUploadComplete: async () => {
      await refreshDocuments();
    },
  });

  const docs = useMemo(() => {
    if (!Array.isArray(documents)) return [];
    return documents.filter(
      (doc) =>
        doc &&
        typeof doc === 'object' &&
        'id' in doc &&
        'name' in doc &&
        'fileKey' in doc &&
        'indexStatus' in doc
    );
  }, [documents]);

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return docs;
    const query = searchQuery.toLowerCase();
    return docs.filter((doc) => doc.name.toLowerCase().includes(query));
  }, [docs, searchQuery]);

  const totalDocs = docs.length;
  const readyDocs = docs.filter((d) => d.indexStatus === 'INDEXED').length;
  const isLoading = kbLoading || docsLoading;

  const handleDeleteClick = useCallback((doc: DocumentItem) => {
    setDocToDelete(doc);
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!docToDelete) return;

    try {
      await deleteDocument({ knowledgeBaseId: kbId, id: docToDelete.id, orgId });
    } finally {
      setDocToDelete(null);
      setShowDeleteConfirm(false);
      await refreshDocuments();
    }
  }, [docToDelete, deleteDocument, kbId, orgId, refreshDocuments]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setDocToDelete(null);
  }, []);

  const handleDownload = useCallback(
    async (doc: DocumentItem) => {
      try {
        const result = await downloadDocument({ documentId: doc.id, kbId: doc.knowledgeBaseId });
        if (result?.url) {
          window.open(result.url, '_blank');
        }
      } catch {
        // Error is handled by the downloadError state from the hook
      }
    },
    [downloadDocument]
  );

  const handleCloseUpload = useCallback(() => {
    uploadHook.resetUploadState();
    setShowUpload(false);
  }, [uploadHook]);

  const handleReload = useCallback(async () => {
    await refreshDocuments();
  }, [refreshDocuments]);

  if (kbError) {
    return (
      <div className="container mx-auto p-12">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to load knowledge base: {kbError.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const description = isLoading
    ? 'Loading documents...'
    : `${totalDocs} ${totalDocs === 1 ? 'document' : 'documents'} · ${readyDocs} indexed`;

  return (
    <div className="container mx-auto p-12">
      <ListingPageLayout
        title={kb?.name || 'Knowledge Base'}
        description={description}
        isLoading={isLoading}
        onReload={handleReload}
        headerActions={
          <div className="flex items-center gap-2">
            <PageSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search documents..."
            />
            {orgId && kbId && (
              <Button variant="outline" asChild>
                <Link href={`/organizations/${orgId}/knowledge-base/${kbId}/stale-report`}>
                  <ShieldAlert className="h-4 w-4 mr-2" />
                  Stale Report
                </Link>
              </Button>
            )}
            <PermissionWrapper requiredPermission="kb:edit">
              {orgId && kbId && (
                <Button variant="outline" asChild>
                  <Link href={`/organizations/${orgId}/knowledge-base/${kbId}/access`}>
                    <Shield className="h-4 w-4 mr-2" />
                    Access Control
                  </Link>
                </Button>
              )}
            </PermissionWrapper>
            <PermissionWrapper requiredPermission="kb:upload">
              <Button onClick={() => setShowUpload(true)}>
                <PlusCircle className="h-4 w-4 mr-2" />
                Upload Documents
              </Button>
            </PermissionWrapper>
          </div>
        }
        data={filteredDocs}
        renderItem={(doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            userSub={userSub ?? ''}
            onDelete={handleDeleteClick}
            onDownload={handleDownload}
            isDeleting={isDeleting}
            isDownloading={isDownloading}
          />
        )}
        isEmpty={!isLoading && filteredDocs.length === 0}
        emptyState={
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/10 px-12 py-20 mx-4 my-8">
            <div className="rounded-full bg-muted p-4 mb-6">
              <FileText className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No documents yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Upload your first documents to start indexing and enable Q&amp;A capabilities.
              Supported formats include PDF, Word, Excel, CSV, and plain text files.
            </p>
            <PermissionWrapper requiredPermission="document:create">
              <Button size="lg" onClick={() => setShowUpload(true)}>
                <Upload className="h-5 w-5 mr-2" />
                Upload Your First Documents
              </Button>
            </PermissionWrapper>
          </div>
        }
      >
        {downloadError && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Download failed: {downloadError.message}</AlertDescription>
          </Alert>
        )}
      </ListingPageLayout>

      <UploadDialog
        open={showUpload}
        onOpenChange={(open) => {
          if (!uploadHook.isBatchUploading) {
            setShowUpload(open);
            if (!open) uploadHook.resetUploadState();
          }
        }}
        orgId={orgId}
        kbId={kbId}
        uploadQueue={uploadHook.uploadQueue}
        isBatchUploading={uploadHook.isBatchUploading}
        uploadErrors={uploadHook.uploadErrors}
        uploadStats={uploadHook.uploadStats}
        uploaderRef={uploadHook.uploaderRef}
        onSelectFiles={uploadHook.onSelectFiles}
        onRetryItem={uploadHook.retryFailedItem}
        onRunBatchUpload={uploadHook.runBatchUpload}
        onCancelBatchUpload={uploadHook.cancelBatchUpload}
        onClose={handleCloseUpload}
      />

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        docName={docToDelete?.name}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
