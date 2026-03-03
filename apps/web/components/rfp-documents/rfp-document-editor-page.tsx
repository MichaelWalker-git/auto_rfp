'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, FileText, Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';

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

  // Header / footer state
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');

  // Populate HTML once loaded
  useEffect(() => {
    if (isHtmlLoading || htmlInitializedRef.current || initialHtml === undefined) return;
    htmlInitializedRef.current = true;
    setHtmlContent(initialHtml);
  }, [initialHtml, isHtmlLoading]);

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
  const isGenerating = doc?.status === 'GENERATING';

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
        </div>

        <Button
          size="sm"
          onClick={handleSaveContent}
          disabled={isMutating || isGenerating || isHtmlLoading || isImageUploading}
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
      </header>

      {/* ── Editor body ── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm font-medium">Generating document content…</p>
            <p className="text-xs">This may take up to a minute. The editor will unlock when ready.</p>
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
            header={headerText}
            onHeaderChange={setHeaderText}
            footer={footerText}
            onFooterChange={setFooterText}
            onUploadImageToS3={handleUploadImageToS3}
            onGetDownloadUrl={handleGetDownloadUrl}
            onUploadingChange={setIsImageUploading}
          />
        )}
      </main>
    </div>
  );
};
