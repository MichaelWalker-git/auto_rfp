'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import { useVersionList } from '../hooks/useVersionList';
import { useVersionContent } from '../hooks/useVersionContent';
import { useVersionLabel } from '../hooks/useVersionLabel';
import { useVersionDelete } from '../hooks/useVersionDelete';
import { useVersionRestore } from '../hooks/useVersionRestore';
import { VersionDropdown } from './VersionDropdown';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { VersionViewModal } from './VersionViewModal';
import { RestoreConfirmDialog } from './RestoreConfirmDialog';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface VersionHistoryControlProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  /**
   * The page's already-polled plan state (W7/W4 step 4): a running plan
   * disables Restore entry points; the running→ready transition revalidates
   * the version list. No new polling is introduced here.
   */
  isPlanRunning: boolean;
  /** Revalidate the plan (content/header) after a successful restore. */
  onPlanRestored?: () => void | Promise<unknown>;
}

/**
 * The version-history feature surface: mounts the header dropdown (W1) and
 * lazily composes the panel (W2), read-only view (W3), and the restore/delete
 * confirmations (W4/W6) on demand (NFR2.15). All data operations live in the
 * five version hooks; the leaf components receive plain data + callbacks.
 */
export const VersionHistoryControl = ({
  orgId,
  projectId,
  opportunityId,
  isPlanRunning,
  onPlanRestored,
}: VersionHistoryControlProps) => {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // Lazy-once mounting: the heavy surfaces enter the tree on first use and
  // stay mounted so Radix close animations survive subsequent toggles.
  const [hasPanelMounted, setHasPanelMounted] = useState(false);
  const [viewedVersionId, setViewedVersionId] = useState<string | null>(null);
  const [hasModalMounted, setHasModalMounted] = useState(false);
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { versions, currentVersionId, isLoading, error, refresh } = useVersionList(
    orgId,
    projectId,
    opportunityId,
    { isPlanRunning },
  );
  const {
    content,
    isLoading: isContentLoading,
    notFound: isVersionNotFound,
    error: contentError,
    retry: retryContent,
  } = useVersionContent(orgId, projectId, opportunityId, viewedVersionId);
  const { saveLabel } = useVersionLabel(orgId, projectId, opportunityId);
  const { deleteVersion, isDeleting } = useVersionDelete(orgId, projectId, opportunityId);
  const { restoreVersion, isRestoring } = useVersionRestore(orgId, projectId, opportunityId, {
    onRestored: onPlanRestored,
  });

  // W3 step 2: a vanished version closes to a REFRESHED list.
  useEffect(() => {
    if (isVersionNotFound) void refresh();
  }, [isVersionNotFound, refresh]);

  const findVersion = useCallback(
    (versionId: string | null): SolutionPlanVersionListItem | null =>
      versions.find((version) => version.versionId === versionId) ?? null,
    [versions],
  );

  const handleView = useCallback((versionId: string) => {
    setHasModalMounted(true);
    setViewedVersionId(versionId);
  }, []);

  const handleSeeAll = useCallback(() => {
    setHasPanelMounted(true);
    setIsPanelOpen(true);
  }, []);

  const handleRestoreRequest = useCallback((versionId: string) => {
    setRestoreError(null);
    setRestoreTargetId(versionId);
  }, []);

  const handleDeleteRequest = useCallback((versionId: string) => {
    setDeleteError(null);
    setDeleteTargetId(versionId);
  }, []);

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoreTargetId) return;
    const result = await restoreVersion(restoreTargetId);
    if (result.outcome === 'restored') {
      setRestoreTargetId(null);
      setViewedVersionId(null);
      return;
    }
    // The specific plain-language message stays inline; the plan is unchanged.
    setRestoreError(result.message);
  }, [restoreTargetId, restoreVersion]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetId) return;
    const result = await deleteVersion(deleteTargetId);
    if (result.outcome === 'deleted' || result.outcome === 'not-found') {
      // Deleted (row disappears) or already gone (toasted + list refreshed).
      if (viewedVersionId === deleteTargetId) setViewedVersionId(null);
      setDeleteTargetId(null);
      return;
    }
    setDeleteError(result.message);
  }, [deleteTargetId, deleteVersion, viewedVersionId]);

  const viewedVersion = content?.version ?? findVersion(viewedVersionId);

  return (
    <>
      <VersionDropdown
        versions={versions}
        currentVersionId={currentVersionId}
        isLoading={isLoading}
        hasError={!!error}
        onSelectVersion={handleView}
        onSeeAll={handleSeeAll}
      />

      {hasPanelMounted && (
        <VersionHistoryPanel
          open={isPanelOpen}
          onOpenChange={setIsPanelOpen}
          versions={versions}
          currentVersionId={currentVersionId}
          isLoading={isLoading}
          hasError={!!error}
          onRetry={() => void refresh()}
          isRestoreDisabled={isPlanRunning}
          onView={handleView}
          onRestore={handleRestoreRequest}
          onDelete={handleDeleteRequest}
          onSaveLabel={saveLabel}
        />
      )}

      {hasModalMounted && (
        <VersionViewModal
          open={viewedVersionId !== null}
          onOpenChange={(next) => {
            if (!next) setViewedVersionId(null);
          }}
          version={viewedVersion}
          html={content?.html ?? null}
          isLoading={isContentLoading}
          hasError={!!contentError}
          notFound={isVersionNotFound}
          onRetry={() => void retryContent()}
          isCurrent={viewedVersionId !== null && viewedVersionId === currentVersionId}
          isRestoreDisabled={isPlanRunning}
          onRestore={() => viewedVersionId && handleRestoreRequest(viewedVersionId)}
          onDelete={() => viewedVersionId && handleDeleteRequest(viewedVersionId)}
          onSaveLabel={(label) =>
            viewedVersionId
              ? saveLabel(viewedVersionId, label)
              : Promise.resolve({ outcome: 'error' as const })
          }
        />
      )}

      {restoreTargetId !== null && (
        <RestoreConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setRestoreTargetId(null);
          }}
          version={findVersion(restoreTargetId)}
          isRestoring={isRestoring}
          errorMessage={restoreError}
          onConfirm={() => void handleRestoreConfirm()}
        />
      )}

      {deleteTargetId !== null && (
        <DeleteConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setDeleteTargetId(null);
          }}
          version={findVersion(deleteTargetId)}
          isDeleting={isDeleting}
          errorMessage={deleteError}
          onConfirm={() => void handleDeleteConfirm()}
        />
      )}
    </>
  );
};
