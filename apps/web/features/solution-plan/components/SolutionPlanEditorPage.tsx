'use client';

import { useCallback, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import {
  RichTextEditor,
  stripPresignedUrlsFromHtml,
} from '@/components/rfp-documents/rich-text-editor';
import { sanitizeGeneratedHtml } from '@/components/rfp-documents/rfp-document-utils';
import { useCurrentOrganization } from '@/context/organization-context';
import { getSaveErrorDescription } from '../lib/save-errors';
import { useSolutionPlan } from '../hooks/useSolutionPlan';
import { useSolutionPlanHtmlContent } from '../hooks/useSolutionPlanHtmlContent';
import { useUpdateSolutionPlan } from '../hooks/useUpdateSolutionPlan';
import { useSolutionPlanActions } from '../hooks/useSolutionPlanActions';
import { useEditorImageUpload } from '../hooks/useEditorImageUpload';
import { SolutionPlanEditorBlockedState } from './SolutionPlanEditorBlockedState';
import { SolutionPlanEditorToolbar } from './SolutionPlanEditorToolbar';
import { VersionHistoryControl } from './VersionHistoryControl';

interface SolutionPlanEditorPageProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

/**
 * Full-page TipTap editor for the Solution Plan ("Source of Truth") HTML.
 * Loads the synthesized body via GET /solution-plan/html-content and saves
 * manual edits via PATCH /solution-plan/update — the server bumps the
 * monotonic version and marks the plan user-edited (ADR-8/11). Regenerate
 * goes through the shared confirm flow that warns manual edits are
 * permanently lost when the plan has been hand-edited (ADR-4). Like the rest
 * of R2, the page is gated on the org-level `enableSolutionPlan` flag.
 */
export const SolutionPlanEditorPage = ({
  orgId,
  projectId,
  opportunityId,
}: SolutionPlanEditorPageProps) => {
  const { toast } = useToast();

  const { currentOrganization, loading: isOrgLoading } = useCurrentOrganization();
  const isFeatureEnabled = !!currentOrganization?.enableSolutionPlan;

  const { plan, isRunning, isLoading: isPlanLoading, notFound, refresh } = useSolutionPlan(
    orgId,
    projectId,
    opportunityId,
  );
  const isReady = plan?.status === 'READY';

  const { content, isLoading: isHtmlLoading, refresh: refreshHtml } = useSolutionPlanHtmlContent(
    orgId,
    projectId,
    opportunityId,
    { enabled: isFeatureEnabled && isReady },
  );

  const { updateSolutionPlan, isUpdating } = useUpdateSolutionPlan(orgId, projectId, opportunityId);
  const { regenerate, isInitializing, ConfirmDialog } = useSolutionPlanActions(
    orgId,
    projectId,
    opportunityId,
    { plan, refresh },
  );
  const { isImageUploading, setIsImageUploading, handleUploadImageToS3, handleGetDownloadUrl } =
    useEditorImageUpload(orgId);

  const [htmlContent, setHtmlContent] = useState('');
  // The server version the editor currently reflects.
  const [editorVersion, setEditorVersion] = useState<number | null>(null);
  // TipTap only reads `value` on mount, so replacing content programmatically
  // (initial load, regenerate) requires a remount via this key. A plain save
  // must NOT bump it — remounting would drop the cursor and scroll position.
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!content) return;
    // Only move forward (versions are monotonic — ADR-11). A stale refetch,
    // or the pre-revalidation window right after a save, must not snap the
    // editor back to older server HTML.
    if (editorVersion !== null && content.version <= editorVersion) return;
    setHtmlContent(sanitizeGeneratedHtml(content.html));
    setEditorVersion(content.version);
    setEditorKey((key) => key + 1);
  }, [content, editorVersion]);

  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;

  const handleSave = useCallback(async () => {
    try {
      const result = await updateSolutionPlan({
        htmlContent: stripPresignedUrlsFromHtml(htmlContent),
      });
      // The editor already shows exactly what was saved — adopt the bumped
      // version so the refetch below doesn't trigger a remount.
      if (result?.plan) setEditorVersion(result.plan.version);
      await Promise.all([refresh(), refreshHtml()]);
      toast({
        title: 'Solution Plan saved',
        description: 'Your edits are now the source of truth for generated documents.',
      });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: getSaveErrorDescription(err),
        variant: 'destructive',
      });
    }
  }, [htmlContent, updateSolutionPlan, refresh, refreshHtml, toast]);

  const handleRegenerate = useCallback(() => void regenerate(), [regenerate]);

  // A successful restore changed the plan's content/header — revalidate both.
  // The bumped `content.version` remounts the editor with the restored HTML.
  const handlePlanRestored = useCallback(async () => {
    await Promise.all([refresh(), refreshHtml()]);
  }, [refresh, refreshHtml]);

  // ── Render ──

  if (isOrgLoading || (isPlanLoading && !plan && !notFound)) {
    return <PageLoadingSkeleton variant="detail" hasDescription />;
  }

  if (!isFeatureEnabled || !plan || isRunning || plan.status === 'FAILED') {
    return (
      <SolutionPlanEditorBlockedState
        plan={plan}
        isRunning={isRunning}
        isFeatureEnabled={isFeatureEnabled}
        backUrl={backUrl}
      />
    );
  }

  // READY — the editable state. 56px matches the dashboard header height.
  const isEditorReady = editorVersion !== null && !isHtmlLoading;
  const isBusy = isUpdating || isInitializing;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <SolutionPlanEditorToolbar
        plan={plan}
        backUrl={backUrl}
        isRegenerateStarting={isInitializing}
        isSaving={isUpdating}
        isBusy={isBusy}
        canSave={isEditorReady && !isImageUploading}
        onRegenerate={handleRegenerate}
        onSave={handleSave}
        versionControl={
          <VersionHistoryControl
            orgId={orgId}
            projectId={projectId}
            opportunityId={opportunityId}
            isPlanRunning={isRunning}
            onPlanRestored={handlePlanRestored}
          />
        }
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        {isEditorReady ? (
          <RichTextEditor
            key={editorKey}
            value={htmlContent}
            onChange={setHtmlContent}
            disabled={isBusy}
            className="h-full rounded-none border-0"
            minHeight="100%"
            onUploadImageToS3={handleUploadImageToS3}
            onGetDownloadUrl={handleGetDownloadUrl}
            onUploadingChange={setIsImageUploading}
          />
        ) : (
          <div className="p-6 space-y-4" data-testid="solution-plan-editor-skeleton">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-[600px] w-full rounded-xl" />
          </div>
        )}
      </div>

      <ConfirmDialog />
    </div>
  );
};
