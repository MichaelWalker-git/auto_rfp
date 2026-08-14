'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Download, FileText, Mail, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { useFoiaArtifacts } from '@/lib/hooks/use-foia-artifacts';
import type { FoiaArtifact, FOIAResponseDocument } from '@auto-rfp/core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number | undefined): string => {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const getFileIcon = (artifact: FoiaArtifact | FOIAResponseDocument) => {
  if ('kind' in artifact) {
    // FoiaArtifact
    switch (artifact.kind) {
      case 'LETTER_TXT':
        return <FileText className="h-4 w-4 text-slate-500" />;
      case 'LETTER_PDF':
        return <FileText className="h-4 w-4 text-red-500" />;
      case 'EML':
        return <Mail className="h-4 w-4 text-blue-500" />;
      case 'AGENCY_RESPONSE':
        return <File className="h-4 w-4 text-emerald-500" />;
      default:
        return <File className="h-4 w-4 text-slate-500" />;
    }
  }

  // FOIAResponseDocument
  if (artifact.contentType?.includes('pdf')) {
    return <FileText className="h-4 w-4 text-red-500" />;
  }
  if (artifact.contentType?.includes('text')) {
    return <FileText className="h-4 w-4 text-slate-500" />;
  }
  return <File className="h-4 w-4 text-slate-500" />;
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaDocumentsListProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  artifacts?: FoiaArtifact[];
  responseDocuments?: FOIAResponseDocument[];
  isLoading?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FoiaDocumentsList = ({
  orgId,
  projectId,
  opportunityId,
  artifacts = [],
  responseDocuments = [],
  isLoading = false,
}: FoiaDocumentsListProps) => {
  const { toast } = useToast();
  const { getDownloadUrl } = useFoiaArtifacts();
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const requestDocuments = artifacts.filter((a) =>
    ['LETTER_TXT', 'LETTER_PDF', 'EML'].includes(a.kind)
  );
  const agencyResponseArtifacts = artifacts.filter((a) => a.kind === 'AGENCY_RESPONSE');

  const handleDownload = async (artifact: FoiaArtifact | FOIAResponseDocument) => {
    setDownloadingKey(artifact.s3Key);
    try {
      const url = await getDownloadUrl(artifact);
      window.open(url, '_blank');
    } catch (error) {
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Could not download file',
        variant: 'destructive',
      });
    } finally {
      setDownloadingKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Request Documents Section */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">Request documents</h4>
        {requestDocuments.length === 0 ? (
          <div className="border rounded-md p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Documents appear here once the request is prepared and approved.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {requestDocuments.map((artifact) => (
              <div
                key={artifact.s3Key}
                className="flex items-center justify-between gap-3 border rounded-md p-3 hover:border-indigo-200 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getFileIcon(artifact)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{artifact.fileName}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatBytes(artifact.sizeBytes)}</span>
                      <span>•</span>
                      <span>{format(new Date(artifact.createdAt), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(artifact)}
                  disabled={downloadingKey === artifact.s3Key}
                  aria-label={`Download ${artifact.fileName}`}
                >
                  {downloadingKey === artifact.s3Key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agency Response Section */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">Agency response</h4>
        {agencyResponseArtifacts.length === 0 && responseDocuments.length === 0 ? (
          <div className="border rounded-md p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Upload what the agency sends back. Response documents will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {agencyResponseArtifacts.map((artifact) => (
              <div
                key={artifact.s3Key}
                className="flex items-center justify-between gap-3 border rounded-md p-3 hover:border-indigo-200 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getFileIcon(artifact)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{artifact.fileName}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatBytes(artifact.sizeBytes)}</span>
                      <span>•</span>
                      <span>{format(new Date(artifact.createdAt), 'MMM d, yyyy')}</span>
                      {artifact.uploadedBy && (
                        <>
                          <span>•</span>
                          <span>by {artifact.uploadedBy}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(artifact)}
                  disabled={downloadingKey === artifact.s3Key}
                  aria-label={`Download ${artifact.fileName}`}
                >
                  {downloadingKey === artifact.s3Key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
            {responseDocuments.map((doc) => (
              <div
                key={doc.s3Key}
                className="flex items-center justify-between gap-3 border rounded-md p-3 hover:border-indigo-200 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getFileIcon(doc)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.fileName}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatBytes(doc.sizeBytes)}</span>
                      <span>•</span>
                      <span>{format(new Date(doc.uploadedAt), 'MMM d, yyyy')}</span>
                      <span>•</span>
                      <span>by {doc.uploadedBy}</span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(doc)}
                  disabled={downloadingKey === doc.s3Key}
                  aria-label={`Download ${doc.fileName}`}
                >
                  {downloadingKey === doc.s3Key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
