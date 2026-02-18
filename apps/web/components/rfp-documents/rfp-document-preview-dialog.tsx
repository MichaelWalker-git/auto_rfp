'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { RFPDocumentItem } from '@/lib/hooks/use-rfp-documents';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: RFPDocumentItem | null;
  previewUrl: string | null;
}

const INLINE_PREVIEWABLE = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'text/plain',
  'text/markdown',
]);

const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function isInlinePreviewable(mimeType: string): boolean {
  return INLINE_PREVIEWABLE.has(mimeType) || mimeType.startsWith('image/');
}

function isDocxType(mimeType: string): boolean {
  return DOCX_TYPES.has(mimeType);
}

function DocxClientPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setIsRendering(true);
        setError(null);

        // Fetch the DOCX file as a blob
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
        const blob = await response.blob();

        // Dynamically import docx-preview (client-side only)
        const { renderAsync } = await import('docx-preview');

        if (!cancelled && containerRef.current) {
          // Clear previous content
          containerRef.current.innerHTML = '';

          await renderAsync(blob, containerRef.current, undefined, {
            className: 'docx-viewer',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.error('DOCX preview error:', err);
          setError(err instanceof Error ? err.message : 'Failed to render document');
        }
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-sm text-red-600">Could not preview document: {error}</p>
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Download Instead
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="h-[70vh] w-full overflow-auto rounded-md border" style={{ background: '#e8e8e8' }}>
      {isRendering && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Rendering Word document...</p>
        </div>
      )}
      <div
        ref={containerRef}
        style={{ display: isRendering ? 'none' : 'block' }}
      />
    </div>
  );
}

export function RFPDocumentPreviewDialog({ open, onOpenChange, document: doc, previewUrl }: Props) {
  if (!doc) return null;

  const canPreviewInline = isInlinePreviewable(doc.mimeType);
  const isDocx = isDocxType(doc.mimeType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {doc.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          {previewUrl && canPreviewInline ? (
            <div className="h-[70vh] w-full">
              {doc.mimeType === 'application/pdf' ? (
                <iframe src={previewUrl} className="w-full h-full rounded-md border" title={doc.name} />
              ) : doc.mimeType.startsWith('image/') ? (
                <div className="flex items-center justify-center h-full bg-muted/30 rounded-md">
                  <img src={previewUrl} alt={doc.name} className="max-w-full max-h-full object-contain rounded" />
                </div>
              ) : (
                <iframe src={previewUrl} className="w-full h-full rounded-md border font-mono text-sm" title={doc.name} />
              )}
            </div>
          ) : previewUrl && isDocx ? (
            <DocxClientPreview url={previewUrl} />
          ) : previewUrl ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <FileText className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">
                Preview is not available for this file type ({doc.mimeType}).
              </p>
              <Button asChild>
                <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in New Tab
                </a>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16">
              <p className="text-muted-foreground text-sm">No preview URL available.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}