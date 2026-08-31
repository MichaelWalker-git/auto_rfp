'use client';

import { useState } from 'react';
import { AlertTriangle, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { RichTextEditor } from '@/components/rfp-documents/rich-text-editor';
import { sanitizeGeneratedHtml } from '@/components/rfp-documents/rfp-document-utils';
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import type { VersionLabelSaveResult } from '../hooks/useVersionLabel';
import { formatVersionTimestamp } from '../lib/version-format';
import { VERSION_NOT_FOUND_MESSAGE } from '../lib/version-errors';
import { LabelInlineEditor } from './LabelInlineEditor';

export const VERSION_CONTENT_ERROR_MESSAGE = "Couldn't load this version's content.";

interface VersionViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Metadata of the viewed version — null while unknown (vanished rows). */
  version: SolutionPlanVersionListItem | null;
  /** The version's HTML body — null while loading/failed. */
  html: string | null;
  isLoading: boolean;
  hasError: boolean;
  /** The version no longer exists (deleted or pruned) — W3 step 2. */
  notFound: boolean;
  onRetry: () => void;
  isCurrent: boolean;
  isRestoreDisabled: boolean;
  onRestore: () => void;
  onDelete: () => void;
  onSaveLabel: (label: string) => Promise<VersionLabelSaveResult>;
}

/**
 * Read-only version view (W3): the version's HTML rendered with the plan's
 * OWN renderer in read-only mode — the single trusted pipeline (NFR3.14; no
 * second HTML rendering path) — under a banner naming the version. Footer:
 * Rename label, Delete… (left) / Close, Restore… (right); the current
 * version offers Rename label + Close only.
 */
export const VersionViewModal = ({
  open,
  onOpenChange,
  version,
  html,
  isLoading,
  hasError,
  notFound,
  onRetry,
  isCurrent,
  isRestoreDisabled,
  onRestore,
  onDelete,
  onSaveLabel,
}: VersionViewModalProps) => {
  const [isEditingLabel, setIsEditingLabel] = useState(false);

  const versionName = version
    ? `${formatVersionTimestamp(version.createdAt)}${version.label ? ` — “${version.label}”` : ''}`
    : 'this version';

  const renderBody = () => {
    if (notFound) {
      return (
        <Alert data-testid="version-view-not-found">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{VERSION_NOT_FOUND_MESSAGE}</AlertDescription>
        </Alert>
      );
    }

    if (hasError) {
      return (
        <div className="space-y-3" data-testid="version-view-error">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{VERSION_CONTENT_ERROR_MESSAGE}</AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" onClick={onRetry} data-testid="version-view-retry">
            Retry
          </Button>
        </div>
      );
    }

    if (isLoading || html === null) {
      return (
        <div className="space-y-4" data-testid="version-view-skeleton">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      );
    }

    return (
      <RichTextEditor
        value={sanitizeGeneratedHtml(html)}
        onChange={() => undefined}
        disabled
        className="h-full rounded-none border-0"
        minHeight="100%"
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Version view</DialogTitle>
          <DialogDescription data-testid="version-view-banner">
            Viewing the version from {versionName} — read-only.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">{renderBody()}</div>

        {isEditingLabel && (
          <LabelInlineEditor
            initialValue={version?.label ?? ''}
            onSave={onSaveLabel}
            onDone={() => setIsEditingLabel(false)}
          />
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={notFound}
              onClick={() => setIsEditingLabel(true)}
              data-testid="version-view-rename"
            >
              <Pencil className="h-4 w-4" />
              Rename label
            </Button>
            {!isCurrent && (
              <Button
                variant="outline"
                size="sm"
                disabled={notFound}
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
                data-testid="version-view-delete"
              >
                <Trash2 className="h-4 w-4" />
                Delete…
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="version-view-close"
            >
              Close
            </Button>
            {!isCurrent && (
              <Button
                size="sm"
                disabled={isRestoreDisabled || isLoading || hasError || notFound}
                onClick={onRestore}
                data-testid="version-view-restore"
              >
                <RotateCcw className="h-4 w-4" />
                Restore…
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
