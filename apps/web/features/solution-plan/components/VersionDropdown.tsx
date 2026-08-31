'use client';

import { ChevronDown, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import { formatVersionDate, formatVersionOrigin, formatVersionTimestamp } from '../lib/version-format';

/** The dropdown shows at most this many recent versions + "See all versions" (W1). */
export const VERSION_DROPDOWN_RECENT_COUNT = 5;

export const NO_VERSIONS_LABEL = 'No versions yet';
export const VERSIONS_EMPTY_EXPLANATION =
  'Versions are captured automatically when the plan is generated, saved, or restored.';

interface VersionDropdownItemProps {
  version: SolutionPlanVersionListItem;
  isCurrent: boolean;
  onSelect: (versionId: string) => void;
}

/** One recent-version entry: date, origin/label, Current marker (W1 step 2). */
export const VersionDropdownItem = ({ version, isCurrent, onSelect }: VersionDropdownItemProps) => (
  <DropdownMenuItem
    onSelect={() => onSelect(version.versionId)}
    className="flex flex-col items-start gap-0.5"
    data-testid={`version-dropdown-item-${version.versionId}`}
  >
    <span className="flex items-center gap-2">
      <span className="text-sm">{formatVersionTimestamp(version.createdAt)}</span>
      {isCurrent && <Badge>Current</Badge>}
    </span>
    <span
      className="max-w-64 truncate text-xs text-muted-foreground"
      title={version.label ?? undefined}
    >
      {formatVersionOrigin(version.origin)}
      {version.label ? ` · “${version.label}”` : ''}
    </span>
  </DropdownMenuItem>
);

interface VersionDropdownProps {
  versions: SolutionPlanVersionListItem[];
  currentVersionId: string | null;
  isLoading: boolean;
  hasError: boolean;
  /** Open the read-only version view (W3) — never a restore (AC2.1.2). */
  onSelectVersion: (versionId: string) => void;
  /** Open the full history panel (W2). */
  onSeeAll: () => void;
}

/**
 * Header version control (W1) — replaces the static "Version {n}" text. The
 * trigger names the current version (the newest HISTORY record via
 * `currentVersionId`, never the plan's internal counter); opening shows up to
 * 5 recent versions + "See all versions". Fetch failure degrades the menu to
 * the "See all versions" entry only — the panel's error+Retry state is the
 * recovery surface. Presentation-only: data and callbacks come from the
 * container.
 */
export const VersionDropdown = ({
  versions,
  currentVersionId,
  isLoading,
  hasError,
  onSelectVersion,
  onSeeAll,
}: VersionDropdownProps) => {
  if (isLoading && versions.length === 0 && !hasError) {
    return <Skeleton className="h-8 w-40" data-testid="version-dropdown-skeleton" />;
  }

  const current = versions.find((version) => version.versionId === currentVersionId) ?? null;
  const recent = versions.slice(0, VERSION_DROPDOWN_RECENT_COUNT);
  const isEmpty = !hasError && versions.length === 0;

  const triggerLabel = hasError
    ? 'Versions'
    : current
      ? `${formatVersionDate(current.createdAt)} · Current`
      : NO_VERSIONS_LABEL;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs text-muted-foreground"
          data-testid="version-dropdown-trigger"
        >
          <History className="h-3.5 w-3.5" />
          {triggerLabel}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {isEmpty && (
          <DropdownMenuItem disabled className="whitespace-normal text-xs text-muted-foreground">
            {VERSIONS_EMPTY_EXPLANATION}
          </DropdownMenuItem>
        )}
        {!hasError &&
          recent.map((version) => (
            <VersionDropdownItem
              key={version.versionId}
              version={version}
              isCurrent={version.versionId === currentVersionId}
              onSelect={onSelectVersion}
            />
          ))}
        {!hasError && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => onSeeAll()} data-testid="version-dropdown-see-all">
          See all versions
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
