'use client';

import React from 'react';
import { FileText, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { usePresignDownload } from '@/lib/hooks/use-presign';
import type { ExtractionSource } from '@auto-rfp/core';

interface ExtractionSourceBadgeProps {
  extractionSource: ExtractionSource | null | undefined;
  /** If true, shows as inline badge. If false, shows as full row */
  compact?: boolean;
}

/**
 * Shows a badge/link to view the source document that an item was extracted from.
 * Used for past performance, labor rates, and BOM items that were created via AI extraction.
 */
export const ExtractionSourceBadge = ({
  extractionSource,
  compact = true,
}: ExtractionSourceBadgeProps) => {
  const { trigger: getPresignedUrl, isMutating: isDownloading } = usePresignDownload();

  if (!extractionSource) return null;

  const { sourceDocumentKey, sourceDocumentName, sourceType } = extractionSource;
  
  // Only show if we have a document key to download
  if (!sourceDocumentKey) {
    // Show indicator that this was extracted, but no downloadable source
    if (compact) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                <FileText className="h-3 w-3" />
                Extracted
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>This item was created via AI extraction</p>
              {sourceType === 'KB_EXTRACTION' && <p className="text-xs text-muted-foreground">Source: Knowledge Base</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <FileText className="h-3 w-3" />
        <span>Created via AI extraction</span>
        {sourceType === 'KB_EXTRACTION' && <span className="text-muted-foreground">(from Knowledge Base)</span>}
      </div>
    );
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!sourceDocumentKey) return;
    try {
      const presignResponse = await getPresignedUrl({ key: sourceDocumentKey });
      if (presignResponse?.url) {
        window.open(presignResponse.url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error('Failed to get presigned download URL:', error);
    }
  };

  const displayName = sourceDocumentName || sourceDocumentKey.split('/').pop() || 'Source Document';

  if (compact) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-auto py-0.5 px-2 text-xs gap-1"
        onClick={handleDownload}
        disabled={isDownloading}
        title={`View source: ${displayName}`}
      >
        <FileText className="h-3 w-3" />
        {isDownloading ? 'Downloading...' : 'Source'}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <FileText className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground">Extracted from:</span>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs text-primary"
        onClick={handleDownload}
        disabled={isDownloading}
      >
        {isDownloading ? (
          'Downloading...'
        ) : (
          <>
            {displayName}
            <Download className="h-3 w-3 ml-1" />
          </>
        )}
      </Button>
    </div>
  );
};

export default ExtractionSourceBadge;
