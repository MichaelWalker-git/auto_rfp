'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Eye, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import type { VersionLabelSaveResult } from '../hooks/useVersionLabel';
import { formatVersionOrigin, formatVersionTimestamp } from '../lib/version-format';
import { LabelInlineEditor } from './LabelInlineEditor';
import { VERSIONS_EMPTY_EXPLANATION } from './VersionDropdown';

export const VERSION_LIST_ERROR_MESSAGE = "Couldn't load the version history.";

/** Content-shaped loading rows (never spinners — team mandate). */
export const VersionListSkeleton = () => (
  <div className="space-y-3" data-testid="version-list-skeleton">
    {Array.from({ length: 5 }, (_, index) => (
      <div key={index} className="space-y-1.5 rounded-md border p-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    ))}
  </div>
);

/** Empty state explaining automatic versioning (W2 step 1). */
export const VersionListEmpty = () => (
  <p className="text-sm text-muted-foreground" data-testid="version-list-empty">
    No versions yet. {VERSIONS_EMPTY_EXPLANATION}
  </p>
);

/** Load-failure state with a Retry affordance (W2 step 1). */
export const VersionListError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="space-y-3" data-testid="version-list-error">
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>{VERSION_LIST_ERROR_MESSAGE}</AlertDescription>
    </Alert>
    <Button variant="outline" size="sm" onClick={onRetry} data-testid="version-list-retry">
      Retry
    </Button>
  </div>
);

interface VersionRowProps {
  version: SolutionPlanVersionListItem;
  isCurrent: boolean;
  /** True while the plan is generating — Restore… is disabled (W4 step 4). */
  isRestoreDisabled: boolean;
  isEditingLabel: boolean;
  onView: (versionId: string) => void;
  onRestore: (versionId: string) => void;
  onRenameLabel: (versionId: string) => void;
  onDelete: (versionId: string) => void;
  onSaveLabel: (versionId: string, label: string) => Promise<VersionLabelSaveResult>;
  onLabelDone: () => void;
}

/**
 * One history entry: date/time, origin, creator display name (including
 * "System" straight from `createdByName`), truncated label with the full
 * text on hover/focus, Current badge — plus the overflow actions. The
 * current row offers View and Rename label only (AC4.1.8, AC6.1.2).
 */
export const VersionRow = ({
  version,
  isCurrent,
  isRestoreDisabled,
  isEditingLabel,
  onView,
  onRestore,
  onRenameLabel,
  onDelete,
  onSaveLabel,
  onLabelDone,
}: VersionRowProps) => {
  // Selecting "Rename label" mounts the inline editor; Radix would then
  // return focus to the menu trigger on close, blurring (= cancelling) the
  // editor immediately. Suppress that one focus restore so the input keeps
  // the focus it just took (W5).
  const suppressCloseFocusRef = useRef(false);

  return (
  <div
    className="space-y-1 rounded-md border p-3"
    data-testid={`version-row-${version.versionId}`}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {formatVersionTimestamp(version.createdAt)}
          </span>
          {isCurrent && <Badge>Current</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatVersionOrigin(version.origin)} · {version.createdByName}
        </p>
        {version.label && !isEditingLabel && (
          <p
            className="max-w-64 truncate text-xs text-muted-foreground"
            title={version.label}
            tabIndex={0}
            data-testid={`version-row-label-${version.versionId}`}
          >
            “{version.label}”
          </p>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Version actions"
            data-testid={`version-row-actions-${version.versionId}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (suppressCloseFocusRef.current) {
              event.preventDefault();
              suppressCloseFocusRef.current = false;
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => onView(version.versionId)}
            data-testid={`version-row-view-${version.versionId}`}
          >
            <Eye className="h-4 w-4" />
            View
          </DropdownMenuItem>
          {!isCurrent && (
            <DropdownMenuItem
              disabled={isRestoreDisabled}
              onSelect={() => onRestore(version.versionId)}
              data-testid={`version-row-restore-${version.versionId}`}
            >
              <RotateCcw className="h-4 w-4" />
              Restore…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              suppressCloseFocusRef.current = true;
              onRenameLabel(version.versionId);
            }}
            data-testid={`version-row-rename-${version.versionId}`}
          >
            <Pencil className="h-4 w-4" />
            Rename label
          </DropdownMenuItem>
          {!isCurrent && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(version.versionId)}
                data-testid={`version-row-delete-${version.versionId}`}
              >
                <Trash2 className="h-4 w-4" />
                Delete…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    {isEditingLabel && (
      <LabelInlineEditor
        initialValue={version.label ?? ''}
        onSave={(value) => onSaveLabel(version.versionId, value)}
        onDone={onLabelDone}
      />
    )}
  </div>
  );
};

interface VersionHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: SolutionPlanVersionListItem[];
  currentVersionId: string | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  isRestoreDisabled: boolean;
  onView: (versionId: string) => void;
  onRestore: (versionId: string) => void;
  onDelete: (versionId: string) => void;
  onSaveLabel: (versionId: string, label: string) => Promise<VersionLabelSaveResult>;
}

/**
 * Full version history side sheet (W2): newest-first rows (the API already
 * orders them), skeleton rows while loading, empty explanation, plain-language
 * error with Retry. Which row is label-editing is local UI state; every data
 * operation arrives as a callback from the container (presentation-only rule).
 */
export const VersionHistoryPanel = ({
  open,
  onOpenChange,
  versions,
  currentVersionId,
  isLoading,
  hasError,
  onRetry,
  isRestoreDisabled,
  onView,
  onRestore,
  onDelete,
  onSaveLabel,
}: VersionHistoryPanelProps) => {
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);

  const renderBody = () => {
    if (isLoading && versions.length === 0 && !hasError) return <VersionListSkeleton />;
    if (hasError) return <VersionListError onRetry={onRetry} />;
    if (versions.length === 0) return <VersionListEmpty />;

    return (
      <div className="space-y-3">
        {versions.map((version) => (
          <VersionRow
            key={version.versionId}
            version={version}
            isCurrent={version.versionId === currentVersionId}
            isRestoreDisabled={isRestoreDisabled}
            isEditingLabel={editingVersionId === version.versionId}
            onView={onView}
            onRestore={onRestore}
            onRenameLabel={setEditingVersionId}
            onDelete={onDelete}
            onSaveLabel={onSaveLabel}
            onLabelDone={() => setEditingVersionId(null)}
          />
        ))}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md" data-testid="version-history-panel">
        <SheetHeader>
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>
            Versions are captured automatically; the newest is the current plan.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{renderBody()}</div>
      </SheetContent>
    </Sheet>
  );
};
