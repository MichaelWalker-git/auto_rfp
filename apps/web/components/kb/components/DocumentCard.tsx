'use client';

import { DocumentItem } from '@auto-rfp/core';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText } from 'lucide-react';
import { DownloadButton } from '@/components/ui/download-button';
import { DeleteButton } from '@/components/ui/delete-button';
import PermissionWrapper from '@/components/permission-wrapper';
import { FreshnessStatusBadge } from '@/components/content-library/FreshnessStatusBadge';
import { getStatusVariant, getStatusLabel } from '../lib/formatting';

interface DocumentCardProps {
  doc: DocumentItem;
  userSub?: string;
  onDelete: (doc: DocumentItem) => void;
  onDownload: (doc: DocumentItem) => Promise<void>;
  isDeleting: boolean;
  isDownloading: boolean;
}

export function DocumentCard({
  doc,
  userSub,
  onDelete,
  onDownload,
  isDeleting,
  isDownloading,
}: DocumentCardProps) {
  return (
    <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60 transition-colors">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="mt-0.5">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">{doc.name}</span>

            <Badge
              variant={getStatusVariant(doc.indexStatus)}
              className="text-[10px] uppercase tracking-wide flex items-center gap-1.5"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  doc.indexStatus === 'INDEXED'
                    ? 'bg-emerald-500'
                    : doc.indexStatus === 'FAILED'
                      ? 'bg-red-500'
                      : 'bg-amber-500'
                }`}
              />
              {getStatusLabel(doc.indexStatus)}
            </Badge>

            <FreshnessStatusBadge
              status={doc.freshnessStatus}
              reason={doc.staleReason}
              staleSince={doc.staleSince}
              compact
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Uploaded{' '}
            {new Date(doc.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
            {doc.createdBy && (
              <span>
                {' '}
                by {doc.createdBy === userSub ? 'you' : doc.createdBy.slice(0, 8) + '…'}
              </span>
            )}
            {doc.lastUsedAt && (
              <span>
                {' '}
                · Last used{' '}
                {new Date(doc.lastUsedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {(!doc.createdBy || doc.createdBy === userSub) && (
          <DownloadButton
            isLoading={isDownloading}
            onClick={() => onDownload(doc)}
            ariaLabel={`Download ${doc.name}`}
            variant="ghost"
            size="icon"
            className="h-9 w-9"
          />
        )}
        <PermissionWrapper requiredPermission="document:delete">
          <DeleteButton
            isLoading={isDeleting}
            onClick={() => onDelete(doc)}
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
          />
        </PermissionWrapper>
      </div>
    </Card>
  );
}
