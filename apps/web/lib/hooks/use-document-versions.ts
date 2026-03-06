'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  RFPDocumentVersion,
  VersionListResponse,
  VersionComparisonResponse,
  RevertVersionDTO,
  CherryPickDTO,
  DiffHunk,
} from '@auto-rfp/core';

// ---------- Fetchers ----------

const fetchVersions = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
  orgId: string,
): Promise<VersionListResponse> => {
  const params = new URLSearchParams({
    projectId,
    opportunityId,
    documentId,
    orgId,
  });
  
  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/versions?${params}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to fetch versions');
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return res.json();
};

const fetchComparison = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
  fromVersion: number,
  toVersion: number,
  orgId: string,
): Promise<VersionComparisonResponse> => {
  const params = new URLSearchParams({
    projectId,
    opportunityId,
    documentId,
    fromVersion: fromVersion.toString(),
    toVersion: toVersion.toString(),
    orgId,
  });

  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/compare?${params}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to fetch version comparison');
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return res.json();
};

// Extended DTO types with orgId for frontend
type RevertVersionArg = RevertVersionDTO & { orgId: string };
type CherryPickArg = CherryPickDTO & { orgId: string };

const revertVersion = async (
  _key: string,
  { arg }: { arg: RevertVersionArg },
): Promise<{ ok: boolean; version: RFPDocumentVersion; html: string }> => {
  const { orgId, ...dto } = arg;
  const params = new URLSearchParams({ orgId });
  
  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/revert?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to revert version');
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return res.json();
};

const cherryPickChanges = async (
  _key: string,
  { arg }: { arg: CherryPickArg },
): Promise<{ ok: boolean; version: RFPDocumentVersion }> => {
  const { orgId, ...dto } = arg;
  const params = new URLSearchParams({ orgId });
  
  const res = await authFetcher(`${env.BASE_API_URL}/rfp-document/cherry-pick?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to cherry-pick changes');
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return res.json();
};

// ---------- Hooks ----------

/**
 * Get all versions for a document
 */
export const useDocumentVersions = (
  projectId?: string,
  opportunityId?: string,
  documentId?: string,
  orgId?: string,
) => {
  return useSWR<VersionListResponse, Error>(
    projectId && opportunityId && documentId && orgId
      ? ['document-versions', projectId, opportunityId, documentId, orgId]
      : null,
    () => fetchVersions(projectId!, opportunityId!, documentId!, orgId!),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
    },
  );
};

/**
 * Compare two versions of a document
 */
export const useVersionComparison = (
  projectId?: string,
  opportunityId?: string,
  documentId?: string,
  fromVersion?: number | null,
  toVersion?: number | null,
  orgId?: string,
) => {
  return useSWR<VersionComparisonResponse, Error>(
    projectId && opportunityId && documentId && fromVersion && toVersion && orgId
      ? ['version-comparison', projectId, opportunityId, documentId, fromVersion, toVersion, orgId]
      : null,
    () => fetchComparison(projectId!, opportunityId!, documentId!, fromVersion!, toVersion!, orgId!),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    },
  );
};

/**
 * Revert to a previous version (mutation)
 * Pass orgId as query parameter, rest of DTO in body
 * Returns the new version info + the HTML content from the reverted version
 */
export const useRevertVersion = () => {
  return useSWRMutation<
    { ok: boolean; version: RFPDocumentVersion; html: string },
    Error,
    string,
    RevertVersionArg
  >('revert-version', revertVersion);
};

/**
 * Cherry-pick changes from another version (mutation)
 * Pass orgId as query parameter, rest of DTO in body
 */
export const useCherryPick = () => {
  return useSWRMutation<
    { ok: boolean; version: RFPDocumentVersion },
    Error,
    string,
    CherryPickArg
  >('cherry-pick-version', cherryPickChanges);
};

// ---------- Diff Navigation Hook (client-side state) ----------

interface UseDiffNavigationOptions {
  hunks: DiffHunk[];
  onNavigate?: (hunk: DiffHunk) => void;
}

/**
 * Hook for line-by-line navigation through diff hunks
 */
export const useDiffNavigation = ({ hunks, onNavigate }: UseDiffNavigationOptions) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentHunk = useMemo(() => hunks[currentIndex] ?? null, [hunks, currentIndex]);
  const totalHunks = hunks.length;
  const hasNext = currentIndex < totalHunks - 1;
  const hasPrev = currentIndex > 0;

  const goToNext = useCallback(() => {
    if (hasNext) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      onNavigate?.(hunks[nextIndex]);
    }
  }, [currentIndex, hasNext, hunks, onNavigate]);

  const goToPrev = useCallback(() => {
    if (hasPrev) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      onNavigate?.(hunks[prevIndex]);
    }
  }, [currentIndex, hasPrev, hunks, onNavigate]);

  const goToIndex = useCallback((index: number) => {
    if (index >= 0 && index < totalHunks) {
      setCurrentIndex(index);
      onNavigate?.(hunks[index]);
    }
  }, [totalHunks, hunks, onNavigate]);

  const reset = useCallback(() => {
    setCurrentIndex(0);
  }, []);

  return {
    currentIndex,
    currentHunk,
    totalHunks,
    hasNext,
    hasPrev,
    goToNext,
    goToPrev,
    goToIndex,
    reset,
  };
};

// ---------- Cherry-Pick Selection Hook (client-side state) ----------

/**
 * Side-specific selection for merge conflict resolution
 * 'from' = keep the older version for this block
 * 'to' = keep the newer version for this block
 * undefined = not yet decided (will use 'to'/newer by default)
 */
export type MergeSelection = 'from' | 'to';

/**
 * Hook to manage merge/cherry-pick selection with side-specific choices
 * Each changed block can independently select 'from' (older) or 'to' (newer) version
 */
export const useCherryPickSelection = () => {
  // Map of block index -> which side is selected ('from' or 'to')
  const [selections, setSelections] = useState<Map<number, MergeSelection>>(new Map());

  // Select a specific side for a block
  const selectSide = useCallback((index: number, side: MergeSelection) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(index);
      // If clicking the same side that's already selected, deselect (remove)
      if (current === side) {
        next.delete(index);
      } else {
        // Select this side
        next.set(index, side);
      }
      return next;
    });
  }, []);

  // Select 'from' (older) version for a block
  const selectFrom = useCallback((index: number) => {
    selectSide(index, 'from');
  }, [selectSide]);

  // Select 'to' (newer) version for a block
  const selectTo = useCallback((index: number) => {
    selectSide(index, 'to');
  }, [selectSide]);

  // Select all blocks to use 'from' (older) version
  const selectAllFrom = useCallback((indices: number[]) => {
    setSelections(new Map(indices.map((idx) => [idx, 'from' as MergeSelection])));
  }, []);

  // Select all blocks to use 'to' (newer) version
  const selectAllTo = useCallback((indices: number[]) => {
    setSelections(new Map(indices.map((idx) => [idx, 'to' as MergeSelection])));
  }, []);

  const clearSelection = useCallback(() => {
    setSelections(new Map());
  }, []);

  // Check if a block has 'from' selected
  const isFromSelected = useCallback((index: number) => selections.get(index) === 'from', [selections]);

  // Check if a block has 'to' selected
  const isToSelected = useCallback((index: number) => selections.get(index) === 'to', [selections]);

  // Get the selected side for a block
  const getSelection = useCallback((index: number) => selections.get(index), [selections]);

  // Legacy compatibility - get indices where 'from' is selected
  const selectedHunks = useMemo(() => {
    const set = new Set<number>();
    selections.forEach((side, idx) => {
      if (side === 'from') set.add(idx);
    });
    return set;
  }, [selections]);

  // Count of blocks with explicit selection
  const selectedCount = selections.size;
  
  // Count by side
  const fromCount = useMemo(() => {
    let count = 0;
    selections.forEach((side) => { if (side === 'from') count++; });
    return count;
  }, [selections]);

  const toCount = useMemo(() => {
    let count = 0;
    selections.forEach((side) => { if (side === 'to') count++; });
    return count;
  }, [selections]);

  return {
    selections,
    selectedHunks, // Legacy: Set of indices where 'from' is selected
    selectedCount,
    fromCount,
    toCount,
    selectFrom,
    selectTo,
    selectSide,
    selectAllFrom,
    selectAllTo,
    clearSelection,
    isFromSelected,
    isToSelected,
    getSelection,
    // Legacy compatibility
    toggleHunk: selectFrom, // Toggle 'from' selection
    selectAll: selectAllFrom, // Select all as 'from'
    isSelected: isFromSelected, // Check if 'from' is selected
  };
};

// ---------- Helper Functions ----------

/**
 * Compute diff hunks from two HTML strings
 * This is a simplified implementation - for production use the 'diff' npm package
 * Install: pnpm add diff @types/diff
 */
export const computeDiffHunks = (fromHtml: string, toHtml: string): DiffHunk[] => {
  // Split by paragraphs/blocks for HTML diffing
  const fromLines = fromHtml.split(/(<\/(?:p|div|h[1-6]|li|tr|td|th)>)/gi);
  const toLines = toHtml.split(/(<\/(?:p|div|h[1-6]|li|tr|td|th)>)/gi);
  
  const hunks: DiffHunk[] = [];
  let hunkIndex = 0;
  
  // Simple diff algorithm - compare line by line
  const maxLen = Math.max(fromLines.length, toLines.length);
  
  for (let i = 0; i < maxLen; i++) {
    const fromLine = fromLines[i] ?? '';
    const toLine = toLines[i] ?? '';
    
    if (fromLine !== toLine) {
      if (!fromLine && toLine) {
        // Added
        hunks.push({
          index: hunkIndex++,
          type: 'added',
          toLineStart: i,
          toLineEnd: i,
          toContent: toLine,
        });
      } else if (fromLine && !toLine) {
        // Removed
        hunks.push({
          index: hunkIndex++,
          type: 'removed',
          fromLineStart: i,
          fromLineEnd: i,
          fromContent: fromLine,
        });
      } else {
        // Modified
        hunks.push({
          index: hunkIndex++,
          type: 'modified',
          fromLineStart: i,
          fromLineEnd: i,
          toLineStart: i,
          toLineEnd: i,
          fromContent: fromLine,
          toContent: toLine,
        });
      }
    }
  }
  
  return hunks;
};

/**
 * Apply selected hunks to create merged HTML for cherry-pick
 * When a hunk is selected, we use the "from" (older) version's content
 * When not selected, we keep the "to" (newer) version's content
 */
export const applySelectedHunks = (
  fromHtml: string,
  toHtml: string,
  hunks: DiffHunk[],
  selectedIndices: Set<number>,
): string => {
  // Start with the "to" version as base
  let result = toHtml;
  
  // For each selected hunk, replace the "to" content with "from" content
  const sortedHunks = [...hunks]
    .filter((h) => selectedIndices.has(h.index))
    .sort((a, b) => (b.toLineStart ?? 0) - (a.toLineStart ?? 0)); // Process from end to start
  
  for (const hunk of sortedHunks) {
    if (hunk.type === 'modified' && hunk.fromContent && hunk.toContent) {
      // Replace the modified content with the older version
      result = result.replace(hunk.toContent, hunk.fromContent);
    } else if (hunk.type === 'added' && hunk.toContent) {
      // Remove the added content (revert to older version which didn't have it)
      result = result.replace(hunk.toContent, '');
    } else if (hunk.type === 'removed' && hunk.fromContent) {
      // Re-add the removed content
      // This is more complex as we need to find the right insertion point
      // For simplicity, we'll append near similar content
      const insertionPoint = result.indexOf(hunk.fromContent.substring(0, 20));
      if (insertionPoint >= 0) {
        result = result.slice(0, insertionPoint) + hunk.fromContent + result.slice(insertionPoint);
      }
    }
  }
  
  return result;
};

/**
 * Format version date for display
 */
export const formatVersionDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Get relative time string (e.g., "2 hours ago")
 */
export const getRelativeTime = (isoDate: string): string => {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return formatVersionDate(isoDate);
};
