'use client';

import React from 'react';
import {
  Download,
  Eye,
  FileDown,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
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
import { cn } from '@/lib/utils';
import {
  type RFPDocumentItem,
  RFP_DOCUMENT_TYPES,
} from '@/lib/hooks/use-rfp-documents';
import { SignatureStatusBadge } from './signature-status-badge';
import { LinearSyncIndicator } from './linear-sync-indicator';
import { GoogleDriveSyncButton } from './google-drive-sync-button';
import { formatDate, formatFileSize, getDocumentTypeStyle } from './rfp-document-utils';

interface RFPDocumentCardProps {
  document: RFPDocumentItem;
  orgId: string;
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

export function RFPDocumentCard({
  document: doc,
  orgId,
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
    <div
      className={cn(
        'rounded-xl border bg-background p-3',
        isBusy && 'opacity-80',
      )}
    >
      <div className="flex items-start gap-3">
        <DocumentIcon />
        <DocumentInfo doc={doc} typeStyle={typeStyle} />
        <DocumentActions
          doc={doc}
          orgId={orgId}
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

function DocumentIcon() {
  return (
    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
      <FileText className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

function DocumentInfo({
  doc,
  typeStyle,
}: {
  doc: RFPDocumentItem;
  typeStyle: { cls: string };
}) {
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
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {doc.description}
        </p>
      )}
    </div>
  );
}

function DocumentStatusBadges({ doc }: { doc: RFPDocumentItem }) {
  return (
    <>
      {doc.status === 'GENERATING' ? (
        <Badge
          variant="outline"
          className="text-xs border border-amber-500/30 text-amber-600 bg-amber-500/5 animate-pulse"
        >
          ⏳ Generating...
        </Badge>
      ) : doc.content && !doc.fileKey ? (
        <Badge
          variant="outline"
          className="text-xs border border-violet-500/30 text-violet-600 bg-violet-500/5"
        >
          🤖 AI Generated
        </Badge>
      ) : doc.fileKey ? (
        <Badge
          variant="outline"
          className="text-xs border border-blue-500/30 text-blue-600 bg-blue-500/5"
        >
          📎 Uploaded
        </Badge>
      ) : null}
      {doc.status === 'FAILED' && (
        <Badge
          variant="outline"
          className="text-xs border border-red-500/30 text-red-600 bg-red-500/5"
        >
          ❌ Failed
        </Badge>
      )}
    </>
  );
}

interface DocumentActionsProps {
  doc: RFPDocumentItem;
  orgId: string;
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
}: DocumentActionsProps) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      {doc.fileKey && (
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={isPreviewLoading}
          onClick={() => onPreview(doc)}
          title="Preview document"
        >
          <Eye className="h-4 w-4" />
        </Button>
      )}

      {doc.fileKey && (
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={isDownloading}
          onClick={() => onDownload(doc)}
          title="Download document"
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
      )}

      {doc.content && (
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => onExport(doc)}
          title="Export document"
        >
          <FileDown className="h-4 w-4" />
        </Button>
      )}

      <GoogleDriveSyncButton
        document={doc}
        orgId={orgId}
        onSyncComplete={onSyncComplete}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(doc)}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit Details
          </DropdownMenuItem>
          {doc.content && (
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
