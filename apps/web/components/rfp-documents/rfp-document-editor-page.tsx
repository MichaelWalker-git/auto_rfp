'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, FileText, Loader2, RefreshCw, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { isDocumentGenerating, isDocumentFailed, isDocumentReady } from '@/lib/constants/rfp-document-status';

import {
  useUpdateRFPDocument,
  useRFPDocumentHtmlContent,
  useRFPDocumentPolling,
} from '@/lib/hooks/use-rfp-documents';
import { RichTextEditor, stripPresignedUrlsFromHtml } from './rich-text-editor';
import { usePresignUpload, usePresignDownload, uploadFileToS3 } from '@/lib/hooks/use-presign';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RFPDocumentEditorPageProps {
  orgId: string;
  projectId: string;
  documentId: string;
  opportunityId: string;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

const EditorSkeleton = () => (
  <div className="flex flex-col h-screen">
    <div className="flex items-center gap-3 px-4 py-3 border-b">
      <Skeleton className="h-8 w-8 rounded" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-8 w-24 ml-auto" />
    </div>
    <div className="flex-1 p-6">
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const RFPDocumentEditorPage = ({
  orgId,
  projectId,
  documentId,
  opportunityId,
}: RFPDocumentEditorPageProps) => {
  const router = useRouter();
  const { toast } = useToast();

  // Poll document metadata (stops once status !== GENERATING)
  const { document: doc, isLoading: isDocLoading } = useRFPDocumentPolling(
    projectId,
    opportunityId,
    documentId,
    orgId,
  );

  // Load HTML content from S3 (or fallback to inline)
  const {
    html: initialHtml,
    isLoading: isHtmlLoading,
    isError: isHtmlError,
    mutate: mutateHtml,
  } = useRFPDocumentHtmlContent(
    doc ? projectId : null,
    doc ? opportunityId : null,
    doc ? documentId : null,
    doc ? orgId : null,
  );

  const { trigger: updateDocument, isMutating } = useUpdateRFPDocument(orgId);

  // ── Presign hooks for image upload/download ──
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

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

  // Local HTML state — editor is the source of truth
  const [htmlContent, setHtmlContent] = useState('');
  const htmlInitializedRef = useRef(false);
  const [isImageUploading, setIsImageUploading] = useState(false);

  // ── Reset initialization when component mounts or doc changes ──
  // This handles the case where you navigate back and then edit the same document again.
  // Without this, the cached SWR data would return immediately with isLoading=false,
  // but htmlInitialized would still be true, preventing re-initialization.
  const docIdRef = useRef(doc?.documentId);
  useEffect(() => {
    const currentDocId = doc?.documentId;
    if (docIdRef.current !== currentDocId && currentDocId) {
      // Document changed, reset initialization state
      console.log('[RFPDocEditor] Document changed, resetting initialization state');
      htmlInitializedRef.current = false;
      setHtmlContent('');
    }
    docIdRef.current = currentDocId;
  }, [doc?.documentId]);

  // Populate HTML once the fetch completes (or fails)
  // Note: initialHtml is always a string ('' when no data), so we initialize when loading completes or errors
  useEffect(() => {
    if (!doc) return;
    // Wait for loading to complete OR error to occur
    if (isHtmlLoading && !isHtmlError) return;
    if (htmlInitializedRef.current) return;

    console.log('[RFPDocEditor] Initializing HTML content', {
      docStatus: doc?.status,
      htmlLength: initialHtml?.length || 0,
      isReady: isDocumentReady(doc?.status),
      isHtmlError,
    });

    htmlInitializedRef.current = true;
    setHtmlContent(initialHtml || '');

    // Show error toast if HTML fetch failed
    if (isHtmlError) {
      toast({
        title: 'Content load warning',
        description: 'Could not load existing content. You can still edit and save.',
        variant: 'default',
      });
    }
  }, [doc, initialHtml, isHtmlLoading, isHtmlError, toast]);

  // When the document finishes generating (status transitions away from GENERATING),
  // invalidate the HTML cache so the editor picks up the newly generated content.
  // Note: currentStatus can be null (ready) or 'FAILED', both mean generation is done
  const prevStatusRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentStatus = doc?.status;
    if (prevStatusRef.current === 'GENERATING' && currentStatus !== 'GENERATING') {
      // Generation just completed — refetch HTML and re-initialize the editor
      console.log('[RFPDocEditor] Generation completed, refetching HTML', { currentStatus });
      htmlInitializedRef.current = false;
      mutateHtml();
    }
    prevStatusRef.current = currentStatus;
  }, [doc?.status, mutateHtml]);

  // Reset when navigating to a different document
  useEffect(() => {
    htmlInitializedRef.current = false;
    setHtmlContent('');
  }, [documentId]);

  const handleHtmlChange = useCallback((html: string) => {
    setHtmlContent(html);
  }, []);

  const handleSaveContent = useCallback(async () => {
    if (!doc) return;
    try {
      const c = doc.content as Record<string, unknown> | null | undefined;
      const cleanHtml = stripPresignedUrlsFromHtml(htmlContent);

      await updateDocument({
        projectId,
        opportunityId,
        documentId,
        content: {
          title: (c?.title as string | undefined) || doc.name,
          customerName: (c?.customerName as string | undefined) || undefined,
          outlineSummary: (c?.outlineSummary as string | undefined) || undefined,
          content: cleanHtml,
        },
      } as Parameters<typeof updateDocument>[0]);

      htmlInitializedRef.current = true;
      await mutateHtml();

      toast({ title: 'Document saved', description: 'Content has been saved.' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save document.',
        variant: 'destructive',
      });
    }
  }, [doc, projectId, opportunityId, documentId, htmlContent, updateDocument, mutateHtml, toast]);

  const isLoading = isDocLoading || isHtmlLoading;
  const isGenerating = isDocumentGenerating(doc?.status);
  const isFailed = isDocumentFailed(doc?.status);
  const isReady = isDocumentReady(doc?.status);

  if (isLoading && !doc) return <EditorSkeleton />;

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Document not found.</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go Back
        </Button>
      </div>
    );
  }

  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Top bar ── */}
      <header className="flex items-center gap-2 px-4 py-2.5 border-b bg-background shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground px-2"
          asChild
        >
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />

        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isGenerating && (
            <Badge
              variant="outline"
              className="text-xs border-amber-500/30 text-amber-600 bg-amber-500/5 animate-pulse shrink-0"
            >
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Generating…
            </Badge>
          )}
          {isFailed && (
            <Badge
              variant="outline"
              className="text-xs border-red-500/30 text-red-600 bg-red-500/5 shrink-0"
            >
              Generation Failed
            </Badge>
          )}
        </div>

        <Button
          size="sm"
          onClick={handleSaveContent}
          disabled={isMutating || isGenerating || isHtmlLoading || isImageUploading}
          title={
            isImageUploading
              ? 'Please wait for image upload to complete'
              : isGenerating
              ? 'Cannot save while document is generating'
              : undefined
          }
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
      </header>

      {/* ── Editor body ── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm font-medium">Generating document content…</p>
            <p className="text-xs">This may take up to a minute. The editor will unlock when ready.</p>
          </div>
        ) : isFailed ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="rounded-full bg-red-50 p-3">
              <FileText className="h-10 w-10 text-red-500" />
            </div>
            <div className="text-center max-w-md">
              <p className="text-sm font-medium text-red-600 mb-1">Generation Failed</p>
              <p className="text-xs text-muted-foreground mb-4">
                {doc?.generationError || 'The AI encountered an error while generating this document.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.back()}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Go Back
              </Button>
            </div>
          </div>
        ) : isHtmlLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading content…</p>
          </div>
        ) : (
          <RichTextEditor
            value={htmlContent}
            onChange={handleHtmlChange}
            disabled={isMutating}
            className="h-full rounded-none border-0"
            minHeight="100%"
            onUploadImageToS3={handleUploadImageToS3}
            onGetDownloadUrl={handleGetDownloadUrl}
            onUploadingChange={setIsImageUploading}
          />
        )}
      </main>
    </div>
  );
};
