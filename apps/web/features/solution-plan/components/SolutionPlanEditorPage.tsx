'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, FileText, Loader2, RefreshCw, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import PermissionWrapper from '@/components/permission-wrapper';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { RichTextEditor } from '@/components/rfp-documents/rich-text-editor';
import { sanitizeGeneratedHtml } from '@/components/rfp-documents/rfp-document-utils';
import type { ApiError } from '@/lib/hooks/api-helpers';
import { useSolutionPlan } from '../hooks/useSolutionPlan';
import { useSolutionPlanHtmlContent } from '../hooks/useSolutionPlanHtmlContent';
import { useUpdateSolutionPlan } from '../hooks/useUpdateSolutionPlan';
import { useSolutionPlanActions } from '../hooks/useSolutionPlanActions';
import { SolutionPlanStatusBadge } from './SolutionPlanStatusBadge';

interface SolutionPlanEditorPageProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

/** Centered full-page state for the non-editable plan statuses, with a way back. */
const EditorTerminalState = ({
  backUrl,
  children,
}: {
  backUrl: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center py-24 gap-4">
    {children}
    <Button variant="outline" asChild>
      <Link href={backUrl}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Opportunity
      </Link>
    </Button>
  </div>
);

/** The body of a 409 from PATCH /solution-plan/update carries a `code`. */
const getApiErrorCode = (error: ApiError): string | undefined =>
  typeof error.details === 'object' && error.details !== null && 'code' in error.details
    ? String((error.details as { code: unknown }).code)
    : undefined;

/**
 * Full-page TipTap editor for the Solution Plan ("Source of Truth") HTML.
 * Loads the synthesized body via GET /solution-plan/html-content and saves
 * manual edits via PATCH /solution-plan/update — the server bumps the
 * monotonic version and marks the plan user-edited (ADR-8/11). Regenerate
 * goes through the shared confirm flow that warns manual edits are
 * permanently lost when the plan has been hand-edited (ADR-4).
 */
export const SolutionPlanEditorPage = ({
  orgId,
  projectId,
  opportunityId,
}: SolutionPlanEditorPageProps) => {
  const { toast } = useToast();

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
    { enabled: isReady },
  );

  const { updateSolutionPlan, isUpdating } = useUpdateSolutionPlan(orgId, projectId, opportunityId);
  const { regenerate, isInitializing, ConfirmDialog } = useSolutionPlanActions(
    orgId,
    projectId,
    opportunityId,
    { plan, refresh },
  );

  const [htmlContent, setHtmlContent] = useState('');
  // The server version the editor was last initialized from. TipTap only reads
  // `value` on mount, so a version bump (save / regenerate) remounts via key.
  const [editorVersion, setEditorVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!content) return;
    if (editorVersion === content.version) return;
    setHtmlContent(sanitizeGeneratedHtml(content.html));
    setEditorVersion(content.version);
  }, [content, editorVersion]);

  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;

  const handleSave = useCallback(async () => {
    try {
      await updateSolutionPlan({ htmlContent });
      await Promise.all([refresh(), refreshHtml()]);
      toast({
        title: 'Solution Plan saved',
        description: 'Your edits are now the source of truth for generated documents.',
      });
    } catch (err) {
      const apiError = err as ApiError;
      const errorCode = apiError.status === 409 ? getApiErrorCode(apiError) : undefined;
      toast({
        title: 'Save failed',
        description:
          errorCode === 'SOLUTION_PLAN_CONFLICT'
            ? 'The plan changed while you were editing — reload to pick up the latest version, then reapply your edits.'
            : errorCode === 'SOLUTION_PLAN_NOT_READY'
              ? 'The plan is not editable right now — a run may be in progress. Refresh and try again.'
              : apiError.message,
        variant: 'destructive',
      });
    }
  }, [htmlContent, updateSolutionPlan, refresh, refreshHtml, toast]);

  const handleRegenerate = useCallback(() => void regenerate(), [regenerate]);

  // ── Render ──

  if (isPlanLoading && !plan && !notFound) {
    return <PageLoadingSkeleton variant="detail" hasDescription />;
  }

  if (!plan) {
    return (
      <EditorTerminalState backUrl={backUrl}>
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          No Solution Plan exists for this opportunity yet.
        </p>
      </EditorTerminalState>
    );
  }

  if (isRunning) {
    return (
      <EditorTerminalState backUrl={backUrl}>
        <SolutionPlanStatusBadge status={plan.status} />
        <p className="text-sm text-muted-foreground max-w-md text-center">
          {plan.status === 'GRILLING'
            ? 'The AI interview is running — follow it live on the opportunity page. The plan becomes editable once it is ready.'
            : 'The Solution Plan is being synthesized. It becomes editable once it is ready.'}
        </p>
      </EditorTerminalState>
    );
  }

  if (plan.status === 'FAILED') {
    return (
      <EditorTerminalState backUrl={backUrl}>
        <Alert variant="destructive" className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Solution Plan generation failed{plan.error ? `: ${plan.error}` : '.'}
          </AlertDescription>
        </Alert>
      </EditorTerminalState>
    );
  }

  // READY — the editable state.
  const isEditorReady = editorVersion !== null && !isHtmlLoading;
  const isBusy = isUpdating || isInitializing;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground px-2 shrink-0"
          asChild
        >
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>

        <span className="text-sm font-medium shrink-0">Solution Plan</span>
        <SolutionPlanStatusBadge status={plan.status} />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Version {plan.version}
          {plan.isUserEdited ? ' · manually edited' : ''}
        </span>

        <div className="flex-1" />

        <div className="flex items-center gap-2 shrink-0">
          <PermissionWrapper requiredPermission="proposal:create">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={isBusy}
              title={
                plan.isUserEdited
                  ? 'Regenerating permanently discards manual edits'
                  : 'Run a new interview and replace this plan'
              }
            >
              {isInitializing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate
                </>
              )}
            </Button>
          </PermissionWrapper>

          <PermissionWrapper requiredPermission="proposal:create">
            <Button size="sm" onClick={handleSave} disabled={isBusy || !isEditorReady}>
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </PermissionWrapper>
        </div>
      </div>

      {/* ── Staleness warning (gate stays open — ADR-3) ── */}
      {plan.isStale && (
        <Alert className="rounded-none border-x-0 shrink-0">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Solution Plan may be outdated — regenerate recommended.
            {plan.staleReason ? ` ${plan.staleReason}` : ''}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Editor ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isEditorReady ? (
          <RichTextEditor
            key={editorVersion}
            value={htmlContent}
            onChange={setHtmlContent}
            disabled={isBusy}
            className="h-full rounded-none border-0"
            minHeight="100%"
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
