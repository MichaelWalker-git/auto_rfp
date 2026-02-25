'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Settings2 as Settings2Icon,
  Trash2,
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
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  type RFPDocumentItem,
  RFP_DOCUMENT_TYPES,
  useSyncRFPDocumentToGoogleDrive,
} from '@/lib/hooks/use-rfp-documents';
import { SignatureStatusBadge } from './signature-status-badge';
import { LinearSyncIndicator } from './linear-sync-indicator';
import { formatDate, formatFileSize, getDocumentTypeStyle } from './rfp-document-utils';

// ─── Google Drive icon ────────────────────────────────────────────────────────

function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-20.4 35.3c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-10.1-17.5c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 23.8h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface RFPDocumentCardProps {
  document: RFPDocumentItem;
  orgId: string;
  projectId: string;
  isDeleting: boolean;
  isDownloading: boolean;
  isPreviewLoading: boolean;
  onPreview: (doc: RFPDocumentItem) => void;
  onDownload: (doc: RFPDocumentItem) => void;
  onEdit: (doc: RFPDocumentItem) => void;
  onExport: (doc: RFPDocumentItem) => void;
  onSignature: (doc: RFPDocumentItem) => void;
  onDelete: (doc: RFPDocumentItem) => void;
  onSyncComplete: () => void;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function RFPDocumentCard({
  document: doc,
  orgId,
  projectId,
  isDeleting,
  isDownloading,
  isPreviewLoading,
  onPreview,
  onDownload,
  onEdit,
  onExport,
  onSignature,
  onDelete,
  onSyncComplete,
}: RFPDocumentCardProps) {
  const typeStyle = getDocumentTypeStyle(doc.documentType);
  const isBusy = isDeleting || isDownloading;

  return (
    <div className={cn('rounded-xl border bg-background p-3', isBusy && 'opacity-80')}>
      <div className="flex items-start gap-3">
        <DocumentIcon />
        <DocumentInfo doc={doc} typeStyle={typeStyle} />
        <DocumentActions
          doc={doc}
          orgId={orgId}
          projectId={projectId}
          isDeleting={isDeleting}
          isDownloading={isDownloading}
          isPreviewLoading={isPreviewLoading}
          onPreview={onPreview}
          onDownload={onDownload}
          onEdit={onEdit}
          onExport={onExport}
          onSignature={onSignature}
          onDelete={onDelete}
          onSyncComplete={onSyncComplete}
        />
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DocumentIcon() {
  return (
    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
      <FileText className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

function DocumentInfo({ doc, typeStyle }: { doc: RFPDocumentItem; typeStyle: { cls: string } }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium truncate" title={doc.name}>
          {doc.name}
        </p>
        <Badge variant="outline" className={cn('text-xs border', typeStyle.cls)}>
          {RFP_DOCUMENT_TYPES[doc.documentType] ?? doc.documentType}
        </Badge>
        <DocumentStatusBadges doc={doc} />
        <SignatureStatusBadge status={doc.signatureStatus} />
        <LinearSyncIndicator status={doc.linearSyncStatus} lastSyncedAt={doc.lastSyncedAt} />
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>v{doc.version}</span>
        <span>{formatFileSize(doc.fileSizeBytes)}</span>
        <span>
          Uploaded: {formatDate(doc.createdAt)}
          {doc.createdByName ? ` by ${doc.createdByName}` : ''}
        </span>
        {doc.updatedAt !== doc.createdAt && (
          <span>
            Updated: {formatDate(doc.updatedAt)}
            {doc.updatedByName ? ` by ${doc.updatedByName}` : ''}
          </span>
        )}
      </div>

      {doc.description && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
      )}

      {doc.googleDriveUrl && (
        <a
          href={doc.googleDriveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open in Google Drive
        </a>
      )}
    </div>
  );
}

function DocumentStatusBadges({ doc }: { doc: RFPDocumentItem }) {
  return (
    <>
      {doc.status === 'GENERATING' ? (
        <Badge variant="outline" className="text-xs border border-amber-500/30 text-amber-600 bg-amber-500/5 animate-pulse">
          ⏳ Generating...
        </Badge>
      ) : (doc.content || doc.htmlContentKey) && !doc.fileKey ? (
        <Badge variant="outline" className="text-xs border border-violet-500/30 text-violet-600 bg-violet-500/5">
          🤖 AI Generated
        </Badge>
      ) : doc.fileKey ? (
        <Badge variant="outline" className="text-xs border border-blue-500/30 text-blue-600 bg-blue-500/5">
          📎 Uploaded
        </Badge>
      ) : null}
      {doc.status === 'FAILED' && (
        <Badge variant="outline" className="text-xs border border-red-500/30 text-red-600 bg-red-500/5">
          ❌ Failed
        </Badge>
      )}
    </>
  );
}

// ─── DocumentActions ──────────────────────────────────────────────────────────

interface DocumentActionsProps {
  doc: RFPDocumentItem;
  orgId: string;
  projectId: string;
  isDeleting: boolean;
  isDownloading: boolean;
  isPreviewLoading: boolean;
  onPreview: (doc: RFPDocumentItem) => void;
  onDownload: (doc: RFPDocumentItem) => void;
  onEdit: (doc: RFPDocumentItem) => void;
  onExport: (doc: RFPDocumentItem) => void;
  onSignature: (doc: RFPDocumentItem) => void;
  onDelete: (doc: RFPDocumentItem) => void;
  onSyncComplete: () => void;
}

function DocumentActions({
  doc,
  orgId,
  projectId,
  isDeleting,
  isDownloading,
  onDownload,
  onEdit,
  onExport,
  onSignature,
  onDelete,
  onSyncComplete,
}: DocumentActionsProps) {
  const { trigger: syncToGoogleDrive } = useSyncRFPDocumentToGoogleDrive(orgId);
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const isContentDoc = !!(doc.content || doc.htmlContentKey);
  const canSync = !!(doc.fileKey || doc.htmlContentKey);
  const isAlreadySynced = !!doc.googleDriveUrl;
  const editorUrl = `/organizations/${orgId}/projects/${projectId}/rfp-documents/${doc.documentId}/edit?opportunityId=${doc.opportunityId}`;

  const handleSync = useCallback(async () => {
    if (isSyncing || !canSync) return;
    try {
      setIsSyncing(true);
      await syncToGoogleDrive({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      toast({
        title: isAlreadySynced ? 'Re-synced to Google Drive' : 'Synced to Google Drive',
        description: `"${doc.name}" has been uploaded to Google Drive.`,
      });
      onSyncComplete();
    } catch (err) {
      toast({
        title: 'Sync failed',
        description: err instanceof Error ? err.message : 'Could not sync to Google Drive',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, canSync, isAlreadySynced, syncToGoogleDrive, doc, toast, onSyncComplete]);

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Download — only for originally uploaded files (not AI-generated content) */}
      {doc.fileKey && !doc.htmlContentKey && (
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={isDownloading}
          onClick={() => onDownload(doc)}
          title="Download original file"
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
      )}

      {/* Edit Content — full-page editor for AI-generated / content-based docs */}
      {isContentDoc && doc.status !== 'GENERATING' && (
        <Button size="sm" variant="outline" className="gap-2" asChild title="Edit document content">
          <Link href={editorUrl}>
            <Pencil className="h-4 w-4" />
            <span className="hidden sm:inline">Edit</span>
          </Link>
        </Button>
      )}

      {/* Export */}
      {isContentDoc && (
        <Button size="sm" variant="outline" className="gap-2" onClick={() => onExport(doc)} title="Export document">
          <FileDown className="h-4 w-4" />
        </Button>
      )}

      {/* ⋯ Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Google Drive — open link (only when synced) */}
          {isAlreadySynced && (
            <DropdownMenuItem asChild>
              <a href={doc.googleDriveUrl!} target="_blank" rel="noopener noreferrer" className="flex items-center">
                <GoogleDriveIcon className="h-4 w-4 mr-2" />
                Open in Google Drive
              </a>
            </DropdownMenuItem>
          )}

          {/* Google Drive — sync / re-sync */}
          {canSync && (
            <DropdownMenuItem
              disabled={isSyncing}
              onClick={handleSync}
              className="flex items-center"
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : isAlreadySynced ? (
                <RefreshCw className="h-4 w-4 mr-2" />
              ) : (
                <GoogleDriveIcon className="h-4 w-4 mr-2" />
              )}
              {isAlreadySynced ? 'Re-sync to Google Drive' : 'Sync to Google Drive'}
            </DropdownMenuItem>
          )}

          {(isAlreadySynced || canSync) && <DropdownMenuSeparator />}

          {/* Edit Content — full-page editor */}
          {isContentDoc && doc.status !== 'GENERATING' && (
            <DropdownMenuItem asChild>
              <Link href={editorUrl} className="flex items-center">
                <Pencil className="h-4 w-4 mr-2" />
                Edit Content
              </Link>
            </DropdownMenuItem>
          )}

          {/* Edit Details — metadata dialog */}
          <DropdownMenuItem onClick={() => onEdit(doc)}>
            <Settings2Icon className="h-4 w-4 mr-2" />
            Edit Details
          </DropdownMenuItem>

          {isContentDoc && (
            <DropdownMenuItem onClick={() => onExport(doc)}>
              <FileDown className="h-4 w-4 mr-2" />
              Export
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={() => onSignature(doc)}>
            <FileText className="h-4 w-4 mr-2" />
            Signature Status
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-red-600"
            disabled={isDeleting}
            onClick={() => onDelete(doc)}
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
  );
}
