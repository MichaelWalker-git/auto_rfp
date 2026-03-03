'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileDown, FileText, Loader2, RefreshCw, Save } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';

import {
  useGenerateRFPDocument,
  useRFPDocumentHtmlContent,
  useRFPDocumentPolling,
  useUpdateRFPDocument,
} from '@/lib/hooks/use-rfp-documents';
import { uploadFileToS3, usePresignDownload, usePresignUpload } from '@/lib/hooks/use-presign';
import { RichTextEditor, stripPresignedUrlsFromHtml } from './rich-text-editor';
import { RFPDocumentExportDialog } from './rfp-document-export-dialog';

// ─── Props ────────────────────────────────────────────────────────────────────

interface OpportunityDocumentEditorPageProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

const EditorSkeleton = () => (
  <div className="p-6 space-y-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-[600px] w-full rounded-xl" />
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const OpportunityDocumentEditorPage = ({
  orgId,
  projectId,
  opportunityId,
  documentId,
}: OpportunityDocumentEditorPageProps) => {
  const { toast } = useToast();
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  // Track whether we've initialized the editor with content from the server.
  // Must be state (not ref) so React re-renders when initialization completes.
  const [htmlInitialized, setHtmlInitialized] = useState(false);
  // Ref mirrors state to avoid stale closure issues in callbacks
  const htmlInitializedRef = useRef(false);

  // ── Data fetching ──

  const { document: doc, isLoading: isDocLoading } = useRFPDocumentPolling(
    projectId,
    opportunityId,
    documentId,
    orgId,
  );

  // Only fetch HTML once doc is loaded (key is null until then).
  // The hook always returns html as a string ('' when not yet loaded).
  const htmlFetchEnabled = !!doc;
  const {
    html: serverHtml,
    isLoading: isHtmlLoading,
    isError: isHtmlError,
    mutate: mutateHtml,
  } = useRFPDocumentHtmlContent(
    htmlFetchEnabled ? projectId : null,
    htmlFetchEnabled ? opportunityId : null,
    htmlFetchEnabled ? documentId : null,
    htmlFetchEnabled ? orgId : null,
  );

  const { trigger: updateDocument, isMutating } = useUpdateRFPDocument(orgId);
  const { trigger: triggerGenerate, isMutating: isRegenerating } = useGenerateRFPDocument(orgId);
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

  // ── Image upload handlers ──

  const handleUploadImageToS3 = useCallback(async (file: File): Promise<string> => {
    const presign = await triggerPresignUpload({
      fileName: file.name,
      contentType: file.type,
      prefix: `${orgId}/editor-images`,
    });
    await uploadFileToS3(presign.url, presign.method, file);
    return presign.key;
  }, [orgId, triggerPresignUpload]);

  const handleGetDownloadUrl = useCallback(async (key: string): Promise<string> => {
    const presign = await triggerPresignDownload({ key });
    return presign.url;
  }, [triggerPresignDownload]);

  // Track whether the HTML fetch has ever been in a loading state.
  // This prevents initializing with '' before the fetch actually starts.
  const htmlFetchStartedRef = useRef(false);
  useEffect(() => {
    if (isHtmlLoading) htmlFetchStartedRef.current = true;
  }, [isHtmlLoading]);

  // Reset fetch-started flag when document changes
  useEffect(() => {
    htmlFetchStartedRef.current = false;
  }, [documentId]);

  // ── HTML initialization ──
  // Initialize the editor once:
  //   1. doc is loaded (HTML fetch key is non-null)
  //   2. The fetch has started (isHtmlLoading was true at least once)
  //   3. The fetch is now done (isHtmlLoading is false)
  //   4. Not already initialized

  useEffect(() => {
    if (!doc) return;
    if (isHtmlLoading) return;
    if (!htmlFetchStartedRef.current && !isHtmlError) return; // fetch hasn't started yet
    if (htmlInitializedRef.current) return;

    htmlInitializedRef.current = true;
    setHtmlInitialized(true);
    setHtmlContent(serverHtml || '');
  }, [doc, isHtmlLoading, isHtmlError, serverHtml]);

  // Reset when navigating to a different document
  useEffect(() => {
    htmlInitializedRef.current = false;
    setHtmlInitialized(false);
    setHtmlContent('');
  }, [documentId]);

  // ── Handlers ──

  const handleRegenerate = useCallback(async () => {
    if (!doc) return;
    try {
      await triggerGenerate({
        projectId,
        opportunityId,
        documentType: doc.documentType,
        documentId,
      });
      toast({ title: 'Regeneration started', description: 'The document is being regenerated by AI.' });
    } catch (err) {
      toast({
        title: 'Regeneration failed',
        description: err instanceof Error ? err.message : 'Could not start regeneration.',
        variant: 'destructive',
      });
    }
  }, [doc, projectId, opportunityId, documentId, triggerGenerate, toast]);

  const handleSaveContent = useCallback(async () => {
    if (!doc) return;
    try {
      const cleanHtml = stripPresignedUrlsFromHtml(htmlContent);
      await updateDocument({
        projectId,
        opportunityId,
        documentId,
        content: {
          title: doc.name,
          content: cleanHtml,
        },
      } as Parameters<typeof updateDocument>[0]);
      htmlInitializedRef.current = true;
      await mutateHtml();
      toast({ title: 'Document saved', description: 'Content has been saved successfully.' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save document.',
        variant: 'destructive',
      });
    }
  }, [doc, projectId, opportunityId, documentId, htmlContent, updateDocument, mutateHtml, toast]);

  // ── Derived state ──

  const isGenerating = doc?.status === 'GENERATING';
  // Editor is ready when: not generating, HTML fetch done (or errored), and initialized.
  // Uses htmlInitialized (state) so React re-renders when initialization completes.
  const isEditorReady = !isGenerating && !isHtmlLoading && htmlInitialized;
  const isBusy = isMutating || isRegenerating || isGenerating;
  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;

  // ── Render ──

  if (isDocLoading && !doc) return <EditorSkeleton />;

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Document not found.</p>
        <Button variant="outline" asChild>
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Opportunity
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background shrink-0">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground px-2 shrink-0"
          asChild
        >
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>

        {/* Generating badge */}
        {isGenerating && (
          <Badge
            variant="outline"
            className="text-xs border-amber-500/30 text-amber-600 bg-amber-500/5 animate-pulse shrink-0"
          >
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Generating…
          </Badge>
        )}

        {/* Spacer — pushes actions to the right */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowExport(true)}
          disabled={isBusy || !isEditorReady}
          title="Export document"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRegenerate}
          disabled={isBusy}
        >
          {isRegenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
            </>
          )}
        </Button>

        <Button
          size="sm"
          onClick={handleSaveContent}
          disabled={isBusy || isHtmlLoading || isImageUploading}
          title={isImageUploading ? 'Please wait for image upload to complete' : undefined}
        >
          {isMutating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save
            </>
          )}
        </Button>
        </div>{/* end actions */}
      </div>{/* end toolbar */}

      {/* ── Editor ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm font-medium">Generating document content…</p>
            <p className="text-xs">This may take up to a minute.</p>
          </div>
        ) : !isEditorReady ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading content…</p>
          </div>
        ) : (
          <RichTextEditor
            value={htmlContent}
            onChange={setHtmlContent}
            disabled={isMutating}
            className="h-full rounded-none border-0"
            minHeight="100%"
            onUploadImageToS3={handleUploadImageToS3}
            onGetDownloadUrl={handleGetDownloadUrl}
            onUploadingChange={setIsImageUploading}
          />
        )}
      </div>

      {/* ── Export dialog ── */}
      <RFPDocumentExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        document={doc}
        orgId={orgId}
        htmlContent={htmlContent}
      />
    </div>
  );
};
