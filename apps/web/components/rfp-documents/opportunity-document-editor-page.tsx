'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, FileDown, FileText, History, Loader2, RefreshCw, Save, ClipboardCheck, XCircle, AlertTriangle, ChevronRight, ChevronLeft } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { isDocumentGenerating, isDocumentFailed, isDocumentReady } from '@/lib/constants/rfp-document-status';

import { useSWRConfig } from 'swr';
import {
  useGenerateRFPDocument,
  useRFPDocumentHtmlContent,
  useRFPDocumentPolling,
  useUpdateRFPDocument,
} from '@/lib/hooks/use-rfp-documents';
import { uploadFileToS3, usePresignDownload, usePresignUpload } from '@/lib/hooks/use-presign';
import { useRevertVersion, useCherryPick } from '@/lib/hooks/use-document-versions';
import { RichTextEditor, stripPresignedUrlsFromHtml } from './rich-text-editor';
import { sanitizeGeneratedHtml } from './rfp-document-utils';
import { RFPDocumentExportDialog } from './rfp-document-export-dialog';
import { RequestApprovalButton, ApprovalStatusBadge, ResubmitForReviewButton } from '@/features/document-approval';
import { useApprovalHistory } from '@/features/document-approval';
import { ReviewSidebarPanel } from '@/features/document-approval/components/ReviewSidebarPanel';
import { useAuth } from '@/components/AuthProvider';
import { VersionHistoryPanel } from './version-history/VersionHistoryPanel';
import { VersionDiffView } from './version-diff/VersionDiffView';
import { RevertConfirmDialog } from './dialogs/RevertConfirmDialog';
import { CherryPickConfirmDialog } from './dialogs/CherryPickConfirmDialog';
import { AIChatPanel } from './ai-chat';
import type { RFPDocumentVersion } from '@auto-rfp/core';

// ─── Props ────────────────────────────────────────────────────────────────────

interface OpportunityDocumentEditorPageProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

const EditorSkeleton = () => (
  <div className="p-6 space-y-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-[600px] w-full rounded-xl" />
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const OpportunityDocumentEditorPage = ({
  orgId,
  projectId,
  opportunityId,
  documentId,
}: OpportunityDocumentEditorPageProps) => {
  const { toast } = useToast();
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  // Track whether we've initialized the editor with content from the server.
  // Must be state (not ref) so React re-renders when initialization completes.
  const [htmlInitialized, setHtmlInitialized] = useState(false);
  // Ref mirrors state to avoid stale closure issues in callbacks
  const htmlInitializedRef = useRef(false);
  // Manual state to track regeneration start (independent of SWR mutation state)
  const [isRegenerateStarting, setIsRegenerateStarting] = useState(false);
  // Ref version for synchronous reads during render (avoids 1-frame delay from setState)
  const isRegenerateStartingRef = useRef(false);
  // Counter to force editor remount when content is programmatically replaced
  const [editorKey, setEditorKey] = useState(0);
  // Pending auto-save HTML from AI chat edits (saved after editor remounts)
  const pendingAutoSaveRef = useRef<string | null>(null);

  // ── Version history state ──
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showDiffView, setShowDiffView] = useState(false);
  const [diffVersions, setDiffVersions] = useState<{ from: number; to: number } | null>(null);
  const [revertVersion, setRevertVersion] = useState<RFPDocumentVersion | null>(null);
  const [cherryPickData, setCherryPickData] = useState<{
    mergedHtml: string;
    sourceVersion: number;
    selectedCount: number;
  } | null>(null);

  // ── Review sidebar state ──
  const [showReviewSidebar, setShowReviewSidebar] = useState(false);
  
  // ── AI Chat sidebar state ──
  const [showAIChat, setShowAIChat] = useState(true); // Show AI Chat by default
  
  // ── Sidebar width state ──
  const [sidebarWidth, setSidebarWidth] = useState(400); // Default wider width
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Data fetching ──

  const { document: doc, isLoading: isDocLoading, mutate: mutateDoc } = useRFPDocumentPolling(
    projectId,
    opportunityId,
    documentId,
    orgId,
  );

  // Only fetch HTML when doc is loaded AND not generating/regenerating.
  // During generation, the HTML endpoint returns 202/404 — no point fetching.
  // Content will be fetched once generation completes (status transitions away from GENERATING).
  const htmlFetchEnabled = !!doc && !isDocumentGenerating(doc?.status) && !isRegenerateStarting;
  const {
    html: serverHtml,
    isLoading: isHtmlLoading,
    isError: isHtmlError,
    mutate: mutateHtml,
  } = useRFPDocumentHtmlContent(
    htmlFetchEnabled ? projectId : null,
    htmlFetchEnabled ? opportunityId : null,
    htmlFetchEnabled ? documentId : null,
    htmlFetchEnabled ? orgId : null,
  );

  const { trigger: updateDocument, isMutating } = useUpdateRFPDocument(orgId);
  const { trigger: triggerGenerate, isMutating: isRegenerating } = useGenerateRFPDocument(orgId);
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

  // ── Version mutation hooks ──
  const { trigger: triggerRevert, isMutating: isReverting } = useRevertVersion();
  const { trigger: triggerCherryPick, isMutating: isCherryPicking } = useCherryPick();

  // ── SWR config for cache invalidation ──
  const { mutate: globalMutate } = useSWRConfig();
  
  // Helper to invalidate version history cache
  const invalidateVersionsCache = useCallback(() => {
    globalMutate(['document-versions', projectId, opportunityId, documentId, orgId]);
  }, [globalMutate, projectId, opportunityId, documentId, orgId]);

  // ── Image upload handlers ──

  const handleUploadImageToS3 = useCallback(async (file: File): Promise<string> => {
    const presign = await triggerPresignUpload({
      fileName: file.name,
      contentType: file.type,
      prefix: `${orgId}/editor-images`,
    });
    await uploadFileToS3(presign.url, presign.method, file);
    return presign.key;
  }, [orgId, triggerPresignUpload]);

  const handleGetDownloadUrl = useCallback(async (key: string): Promise<string> => {
    const presign = await triggerPresignDownload({ key });
    return presign.url;
  }, [triggerPresignDownload]);

  // ── Reset initialization when HTML fetching becomes enabled ──
  // This handles the case where you navigate back and then edit the same document again.
  // Without this, the cached SWR data would return immediately with isLoading=false,
  // but htmlInitialized would still be true, preventing re-initialization.
  const prevHtmlFetchEnabledRef = useRef(htmlFetchEnabled);
  useEffect(() => {
    if (!prevHtmlFetchEnabledRef.current && htmlFetchEnabled) {
      // HTML fetching just became enabled (key changed from null to URL)
      // Reset initialization state to ensure we initialize with fresh/cached data
      console.log('[OpportunityDocEditor] HTML fetch enabled, resetting initialization state');
      htmlInitializedRef.current = false;
      setHtmlInitialized(false);
    }
    prevHtmlFetchEnabledRef.current = htmlFetchEnabled;
  }, [htmlFetchEnabled]);

  // ── HTML initialization ──
  // Initialize the editor once the HTML fetch completes (or fails):
  //   1. doc is loaded (HTML fetch is enabled)
  //   2. The fetch is complete (not loading) OR errored
  //   3. Not already initialized
  // Note: We don't check if serverHtml is empty — an empty response is valid and should initialize the editor.

  useEffect(() => {
    if (!doc) return;
    // Don't initialize during generation — the "Generating…" overlay handles this state.
    // Content will be initialized after generation completes and HTML is fetched.
    if (isDocumentGenerating(doc.status) || isRegenerateStarting) return;
    // Wait for loading to complete OR error to occur
    if (isHtmlLoading && !isHtmlError) return;
    if (htmlInitializedRef.current) return;

    console.log('[OpportunityDocEditor] Initializing HTML content', {
      docStatus: doc?.status,
      htmlLength: serverHtml?.length || 0,
      isHtmlError,
    });

    htmlInitializedRef.current = true;
    setHtmlInitialized(true);
    setHtmlContent(sanitizeGeneratedHtml(serverHtml || ''));

    // Show error toast if HTML fetch failed
    if (isHtmlError) {
      toast({
        title: 'Content load warning',
        description: 'Could not load existing content. You can still edit and save.',
        variant: 'default',
      });
    }
  }, [doc, isHtmlLoading, isHtmlError, serverHtml, toast, isRegenerateStarting]);

  // Manual polling while waiting for regeneration to start
  useEffect(() => {
    if (!isRegenerateStarting) return;

    const interval = setInterval(() => {
      console.log('[OpportunityDocEditor] Polling document status during regeneration start');
      mutateDoc();
    }, 3000);

    return () => clearInterval(interval);
  }, [isRegenerateStarting, mutateDoc]);

  // Track status changes for regeneration lifecycle
  const prevStatusRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentStatus = doc?.status;

    // When status becomes GENERATING, clear the regenerate starting flag
    if (currentStatus === 'GENERATING' && prevStatusRef.current !== 'GENERATING') {
      console.log('[OpportunityDocEditor] Status became GENERATING, stopping manual polling');
      isRegenerateStartingRef.current = false;
      setIsRegenerateStarting(false);
    }

    // When generation completes (status transitions away from GENERATING),
    // invalidate the HTML cache so the editor picks up the newly generated content
    // Note: currentStatus can be null (ready) or 'FAILED', both mean generation is done
    const generationJustCompleted = prevStatusRef.current === 'GENERATING' && currentStatus !== 'GENERATING';
    
    // Also handle fast-generating documents (like CLARIFYING_QUESTIONS) where the status
    // transitions so quickly that we never see GENERATING state. If we triggered regeneration
    // and the document is now ready, refresh the content.
    const fastGenerationCompleted = isRegenerateStarting && isDocumentReady(currentStatus);
    
    if (generationJustCompleted || fastGenerationCompleted) {
      console.log('[OpportunityDocEditor] Generation completed, refetching HTML', { 
        currentStatus, 
        generationJustCompleted,
        fastGenerationCompleted,
      });
      setIsRegenerateStarting(false);
      htmlInitializedRef.current = false;
      setHtmlInitialized(false);
      // Force SWR to refetch from server (not cache) and increment editor key
      mutateHtml(undefined, { revalidate: true }).then(() => {
        // Force editor remount after HTML is fetched
        setEditorKey((k) => k + 1);
      });
      // Refresh version history — generation creates a new version snapshot
      invalidateVersionsCache();
    }

    prevStatusRef.current = currentStatus;
  }, [doc?.status, mutateHtml, isRegenerateStarting, invalidateVersionsCache]);

  // Reset when navigating to a different document (skip initial mount — component is already fresh)
  const prevDocumentIdRef = useRef(documentId);
  useEffect(() => {
    if (prevDocumentIdRef.current === documentId) return;
    prevDocumentIdRef.current = documentId;
    htmlInitializedRef.current = false;
    setHtmlInitialized(false);
    setHtmlContent('');
  }, [documentId]);

  // ── Handlers ──

  const handleRegenerate = useCallback(async () => {
    if (!doc) return;
    // Set regeneration flag FIRST — ref updates synchronously so any render
    // triggered by subsequent state changes will see isInGeneration=true immediately.
    isRegenerateStartingRef.current = true;
    setIsRegenerateStarting(true);
    htmlInitializedRef.current = false;
    setHtmlInitialized(false);
    try {
      await triggerGenerate({
        projectId,
        opportunityId,
        documentType: doc.documentType,
        documentId,
      });
      toast({ title: 'Regeneration started', description: 'The document is being regenerated by AI.' });
      // Force polling hook to refetch document status immediately
      mutateDoc();
      // Don't reset isRegenerateStarting here - let it stay true until status becomes GENERATING
    } catch (err) {
      toast({
        title: 'Regeneration failed',
        description: err instanceof Error ? err.message : 'Could not start regeneration.',
        variant: 'destructive',
      });
      // Reset on error — htmlFetchEnabled will become true again (isRegenerateStarting=false),
      // which triggers the prevHtmlFetchEnabled effect to re-initialize from SWR cache.
      isRegenerateStartingRef.current = false;
      setIsRegenerateStarting(false);
      htmlInitializedRef.current = false;
      setHtmlInitialized(false);
    }
  }, [doc, projectId, opportunityId, documentId, triggerGenerate, mutateDoc, toast]);

  const handleSaveContent = useCallback(async () => {
    if (!doc) return;
    try {
      const cleanHtml = stripPresignedUrlsFromHtml(htmlContent);
      await updateDocument({
        projectId,
        opportunityId,
        documentId,
        content: {
          title: doc.name,
          content: cleanHtml,
        },
      } as Parameters<typeof updateDocument>[0]);
      htmlInitializedRef.current = true;
      await mutateHtml();
      invalidateVersionsCache(); // Refresh version history
      toast({ title: 'Document saved', description: 'Content has been saved successfully.' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save document.',
        variant: 'destructive',
      });
    }
  }, [doc, projectId, opportunityId, documentId, htmlContent, updateDocument, mutateHtml, invalidateVersionsCache, toast]);

  // ── Auto-save after AI chat edits ──
  // When pendingAutoSaveRef is set, save the document automatically.
  // Uses editorKey as trigger since it changes when the editor remounts after AI edit.
  useEffect(() => {
    if (!pendingAutoSaveRef.current || !doc) return;
    const htmlToSave = pendingAutoSaveRef.current;
    pendingAutoSaveRef.current = null;

    // Delay slightly to let the editor remount first
    const timer = setTimeout(async () => {
      try {
        await updateDocument({
          projectId,
          opportunityId,
          documentId,
          content: {
            title: doc.name,
            content: htmlToSave,
          },
        } as Parameters<typeof updateDocument>[0]);
        htmlInitializedRef.current = true;
        await mutateHtml();
        invalidateVersionsCache();
        toast({ title: 'Auto-saved', description: 'AI changes have been saved automatically.' });
      } catch (err) {
        console.warn('Auto-save after AI edit failed:', err);
        toast({
          title: 'Auto-save failed',
          description: 'AI changes were applied but could not be saved. Please save manually.',
          variant: 'destructive',
        });
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [editorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Version history handlers ──
  const handleCompareVersions = useCallback((fromVersion: number, toVersion: number) => {
    setDiffVersions({ from: fromVersion, to: toVersion });
    setShowDiffView(true);
    setShowVersionHistory(false);
  }, []);

  const handleRevertConfirm = useCallback(async (changeNote?: string) => {
    if (!revertVersion) return;
    try {
      const revertedData = await triggerRevert({
        documentId,
        projectId,
        opportunityId,
        orgId,
        targetVersion: revertVersion.versionNumber,
        changeNote,
      });
      setRevertVersion(null);
      
      // Update editor directly with the reverted HTML content from the response
      if (revertedData?.html) {
        setHtmlContent(revertedData.html);
        // Force editor remount to pick up new content
        setEditorKey((k) => k + 1);
      }
      
      // Also revalidate the SWR cache for consistency
      await mutateHtml();
      invalidateVersionsCache(); // Refresh version history
      
      toast({ title: 'Version reverted', description: `Reverted to version ${revertVersion.versionNumber}.` });
    } catch (err) {
      toast({
        title: 'Revert failed',
        description: err instanceof Error ? err.message : 'Could not revert version.',
        variant: 'destructive',
      });
    }
  }, [revertVersion, documentId, projectId, opportunityId, orgId, triggerRevert, mutateHtml, invalidateVersionsCache, toast]);

  const handleCherryPick = useCallback((mergedHtml: string, sourceVersion: number) => {
    setCherryPickData({ mergedHtml, sourceVersion, selectedCount: 1 });
    // Hide the diff view but keep diffVersions so we can go back
    setShowDiffView(false);
  }, []);

  // Handler to go back to cherry-pick selection from the confirmation dialog
  const handleGoBackToSelection = useCallback(() => {
    setCherryPickData(null);
    setShowDiffView(true);
  }, []);

  const handleCherryPickConfirm = useCallback(async (changeNote?: string) => {
    if (!cherryPickData) return;
    try {
      await triggerCherryPick({
        documentId,
        projectId,
        opportunityId,
        orgId,
        sourceVersion: cherryPickData.sourceVersion,
        mergedHtml: cherryPickData.mergedHtml,
        changeNote,
      });
      // Update editor immediately with merged HTML
      const mergedContent = cherryPickData.mergedHtml;
      setCherryPickData(null);
      setHtmlContent(mergedContent);
      // Force editor remount to pick up new content
      setEditorKey((k) => k + 1);
      // Revalidate the SWR cache
      await mutateHtml();
      invalidateVersionsCache(); // Refresh version history
      toast({ title: 'Changes applied', description: 'Cherry-picked changes have been applied.' });
    } catch (err) {
      toast({
        title: 'Cherry-pick failed',
        description: err instanceof Error ? err.message : 'Could not apply changes.',
        variant: 'destructive',
      });
    }
  }, [cherryPickData, documentId, projectId, opportunityId, orgId, triggerCherryPick, mutateHtml, invalidateVersionsCache, toast]);

  // ── Derived state ──

  const { userSub } = useAuth();
  const { activeApproval, hasPendingApproval, approvals, refresh: refreshApprovals } = useApprovalHistory(
    orgId, projectId, opportunityId, documentId,
  );
  const isApproved = approvals.length > 0 && approvals[0]?.status === 'APPROVED';
  const isReviewer = !!(activeApproval && userSub && activeApproval.reviewerId === userSub);
  
  // Check if document was recently rejected by current user
  const wasRecentlyRejected = approvals.length > 0 && 
    approvals[0]?.status === 'REJECTED' && 
    approvals[0]?.requestedBy === userSub;
    
  // Get the most recent rejected approval for the current user
  const rejectedApproval = wasRecentlyRejected ? approvals[0] : null;

  const isGenerating = isDocumentGenerating(doc?.status);
  const isFailed = isDocumentFailed(doc?.status);
  const isReady = isDocumentReady(doc?.status);
  // Treat the document as "in generation" if either the backend status says so
  // OR we've locally triggered regeneration (covers the gap before backend confirms).
  // Also keep showing generation state while htmlInitialized is false after generation
  // was recently active (prevents blank flash during state transitions).
  // Use BOTH state and ref for isRegenerateStarting — ref is synchronous (no 1-frame delay),
  // state triggers re-renders. Together they ensure no gap where isInGeneration is false.
  const isInGeneration = isGenerating || isRegenerateStarting || isRegenerateStartingRef.current || isRegenerating
    || (!htmlInitialized && !isFailed && prevStatusRef.current === 'GENERATING');
  // Editor is ready when: document is ready (not generating/failed), HTML fetch done, and initialized.
  // Uses htmlInitialized (state) so React re-renders when initialization completes.
  const isEditorReady = isReady && !isInGeneration && !isHtmlLoading && htmlInitialized;
  const isBusy = isMutating || isInGeneration;
  const isEditingDisabled = isBusy || isApproved;
  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;

  // Auto-switch to review tab when there are pending actions
  useEffect(() => {
    if ((hasPendingApproval && isReviewer) || wasRecentlyRejected) {
      setShowReviewSidebar(true);
      setShowVersionHistory(false);
    }
  }, [hasPendingApproval, isReviewer, wasRecentlyRejected]);

  // ── Sidebar resize handlers ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const newWidth = window.innerWidth - e.clientX;
    const minWidth = 300;
    const maxWidth = 600;
    
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // ── Render ──

  if (isDocLoading && !doc) return <EditorSkeleton />;

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Document not found.</p>
        <Button variant="outline" asChild>
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Opportunity
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background shrink-0">
        {/* Back button */}
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

        {/* Status badges */}
        {isGenerating && (
          <Badge
            variant="outline"
            className="text-xs border-amber-500/30 text-amber-600 bg-amber-500/5 animate-pulse shrink-0"
          >
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Generating…
          </Badge>
        )}
        {isFailed && (
          <Badge
            variant="outline"
            className="text-xs border-red-500/30 text-red-600 bg-red-500/5 shrink-0"
          >
            Generation Failed
          </Badge>
        )}

        {/* Spacer — pushes actions to the right */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
        {/* Approval status badge */}
        {isApproved && <ApprovalStatusBadge status="APPROVED" />}
        {hasPendingApproval && <ApprovalStatusBadge status="PENDING" />}

        {/* Request Approval button — hidden for reviewer, approved docs, and recently rejected docs */}
        {doc && doc.status !== 'GENERATING' && doc.status !== 'FAILED' && userSub && !isReviewer && !isApproved && !wasRecentlyRejected && (
          <RequestApprovalButton
            orgId={orgId}
            projectId={projectId}
            opportunityId={opportunityId}
            documentId={documentId}
            documentName={doc.name}
            disabled={isBusy || hasPendingApproval}
            onSuccess={() => {
              refreshApprovals(); // Reload approval history
              // Auto-switch to review tab to show the new pending approval
              setShowReviewSidebar(true);
              setShowVersionHistory(false);
            }}
          />
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowExport(true)}
          disabled={isBusy || !isEditorReady}
          title="Export document"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRegenerate}
          disabled={isEditingDisabled}
          title={isApproved ? 'Cannot regenerate an approved document' : isGenerating ? 'Document is currently generating' : 'Regenerate document with AI'}
        >
          {isRegenerateStarting || isRegenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting…
            </>
          ) : isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
            </>
          )}
        </Button>

        <Button
          size="sm"
          onClick={handleSaveContent}
          disabled={isEditingDisabled || isHtmlLoading || isImageUploading}
          title={
            isApproved
              ? 'Cannot edit an approved document'
              : isImageUploading
              ? 'Please wait for image upload to complete'
              : isGenerating
              ? 'Cannot save while document is generating'
              : undefined
          }
        >
          {isMutating ? (
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
        </div>{/* end actions */}
      </div>{/* end toolbar */}

      {/* ── Editor with permanent right sidebar ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main editor area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {/* Priority 1: Generation state — checked first, always wins */}
          {isInGeneration ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground bg-background">
              <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
              <p className="text-sm font-medium">Generating document content…</p>
              <p className="text-xs">This may take up to a minute.</p>
            </div>
          ) : isFailed ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 bg-background">
              <div className="rounded-full bg-red-50 p-3">
                <FileText className="h-10 w-10 text-red-500" />
              </div>
              <div className="text-center max-w-md">
                <p className="text-sm font-medium text-red-600 mb-1">Generation Failed</p>
                <p className="text-xs text-muted-foreground mb-4">
                  {doc?.generationError || 'The AI encountered an error while generating this document.'}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRegenerate}
                  disabled={isBusy}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            </div>
          ) : isEditorReady ? (
            <RichTextEditor
              key={editorKey}
              value={htmlContent}
              onChange={setHtmlContent}
              disabled={isMutating || isApproved}
              className="h-full rounded-none border-0"
              minHeight="100%"
              onUploadImageToS3={handleUploadImageToS3}
              onGetDownloadUrl={handleGetDownloadUrl}
              onUploadingChange={setIsImageUploading}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground bg-background">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Loading content…</p>
            </div>
          )}
        </div>

        {/* ── Resize Handle (only when not collapsed) ── */}
        {!sidebarCollapsed && (
          <div
            className="w-0.5 bg-border/50 hover:bg-indigo-300 cursor-ew-resize flex-shrink-0 transition-colors"
            onMouseDown={handleMouseDown}
            title="Drag to resize sidebar"
          />
        )}

        {/* ── Resizable Right Sidebar ── */}
        <div 
          className={`bg-background flex flex-col shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? '' : 'border-l-[0.5px] border-border/50'}`}
          style={{ width: sidebarCollapsed ? '48px' : `${sidebarWidth}px`, minWidth: sidebarCollapsed ? '48px' : undefined, overflow: sidebarCollapsed ? 'visible' : 'hidden' }}
        >
          {!sidebarCollapsed && (
            <>
              {/* Header with segmented control and collapse button */}
              <div className="flex items-center justify-between p-4 border-b-[0.5px] border-border/50">
                {/* iOS-style segmented control */}
                <div className="flex bg-muted/50 rounded-lg p-1 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowAIChat(true);
                      setShowVersionHistory(false);
                      setShowReviewSidebar(false);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      showAIChat
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Bot className="h-3.5 w-3.5 mr-1.5" />
                    AI Chat
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowVersionHistory(true);
                      setShowReviewSidebar(false);
                      setShowAIChat(false);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      showVersionHistory && !showReviewSidebar && !showAIChat
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <History className="h-3.5 w-3.5 mr-1.5" />
                    History
                  </Button>
                  
                  {approvals.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowReviewSidebar(true);
                        setShowVersionHistory(false);
                        setShowAIChat(false);
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all relative ${
                        showReviewSidebar
                          ? "bg-background text-foreground shadow-sm"
                          : hasPendingApproval && isReviewer
                          ? "text-amber-700 hover:text-amber-800"
                          : wasRecentlyRejected
                          ? "text-red-700 hover:text-red-800"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
                      Review
                      {(hasPendingApproval && isReviewer) || wasRecentlyRejected ? (
                        <div className="absolute -top-1 -right-1 h-2 w-2 bg-red-500 rounded-full animate-pulse" />
                      ) : null}
                    </Button>
                  )}
                </div>
                
                {/* Collapse button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSidebarCollapsed(true)}
                  className="h-8 w-8 p-0 hover:bg-muted"
                  title="Collapse sidebar"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Sidebar content */}
              <div className="flex-1 overflow-hidden">
                {showAIChat && (
                  <AIChatPanel
                    orgId={orgId}
                    projectId={projectId}
                    opportunityId={opportunityId}
                    documentId={documentId}
                    htmlContent={htmlContent}
                    onApplyEdit={(newHtml, sectionTitle) => {
                      // Convert presigned S3 URLs back to s3key: format before remounting.
                      // The editor's htmlContent contains temporary presigned URLs for images.
                      // When we remount the editor, it needs s3key: references so it can
                      // re-resolve them to fresh presigned URLs via onGetDownloadUrl.
                      const cleanedHtml = stripPresignedUrlsFromHtml(newHtml);
                      setHtmlContent(cleanedHtml);
                      // Force editor remount to pick up the new content.
                      // TipTap only reads `value` on mount — subsequent changes require remount.
                      setEditorKey((k) => k + 1);

                      // Schedule auto-save with the cleaned HTML
                      pendingAutoSaveRef.current = cleanedHtml;

                      // Scroll to the updated section after the editor remounts
                      if (sectionTitle) {
                        setTimeout(() => {
                          // The editor content is inside a nested scroll container
                          // Find the ProseMirror element and its scrollable parent
                          const proseMirror = document.querySelector('.tiptap-document-editor .ProseMirror');
                          if (!proseMirror) return;
                          // Find the heading that matches the section title within ProseMirror
                          const headings = proseMirror.querySelectorAll('h1, h2, h3');
                          for (const heading of Array.from(headings)) {
                            if (heading.textContent?.trim() === sectionTitle) {
                              // Find the scrollable container (overflow-y-auto parent)
                              let scrollContainer = heading.parentElement;
                              while (scrollContainer && scrollContainer !== document.body) {
                                const style = window.getComputedStyle(scrollContainer);
                                if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
                                scrollContainer = scrollContainer.parentElement;
                              }
                              if (scrollContainer) {
                                const headingRect = heading.getBoundingClientRect();
                                const containerRect = scrollContainer.getBoundingClientRect();
                                const scrollOffset = headingRect.top - containerRect.top + scrollContainer.scrollTop - 20;
                                scrollContainer.scrollTo({ top: scrollOffset, behavior: 'smooth' });
                              }
                              // Brief highlight effect
                              (heading as HTMLElement).style.outline = '2px solid var(--primary)';
                              (heading as HTMLElement).style.outlineOffset = '4px';
                              (heading as HTMLElement).style.borderRadius = '4px';
                              setTimeout(() => {
                                (heading as HTMLElement).style.outline = '';
                                (heading as HTMLElement).style.outlineOffset = '';
                                (heading as HTMLElement).style.borderRadius = '';
                              }, 2000);
                              break;
                            }
                          }
                        }, 800); // Wait for editor to remount, render, and resolve images
                      }
                    }}
                    disabled={isEditingDisabled || !isEditorReady}
                  />
                )}

                {showVersionHistory && !showAIChat && (
                  <VersionHistoryPanel
                    projectId={projectId}
                    opportunityId={opportunityId}
                    documentId={documentId}
                    orgId={orgId}
                    isOpen={true}
                    onClose={() => {}} // No close button needed in permanent sidebar
                    onCompare={handleCompareVersions}
                    onRevert={(version) => setRevertVersion(version)}
                  />
                )}
                
                {showReviewSidebar && !showAIChat && userSub && (
                  <ReviewSidebarPanel
                    approval={activeApproval}
                    approvals={approvals}
                    currentUserId={userSub}
                    isOpen={true}
                    onClose={() => {}} // No close button needed in permanent sidebar
                    onSuccess={() => {
                      refreshApprovals();
                      // Stay on review tab after success
                    }}
                  />
                )}
                
                {!showVersionHistory && !showReviewSidebar && !showAIChat && (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p className="text-sm">Select a tab to view content</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Collapsed sidebar content */}
          {sidebarCollapsed && (
            <div className="flex flex-col items-center gap-1.5 py-3 w-full border-l border-border/50">
              {/* Expand button */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSidebarCollapsed(false)}
                className="h-8 w-8 mb-2"
                title="Expand sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  setSidebarCollapsed(false);
                  setShowAIChat(true);
                  setShowVersionHistory(false);
                  setShowReviewSidebar(false);
                }}
                className="h-8 w-8"
                title="AI Chat"
              >
                <Bot className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  setSidebarCollapsed(false);
                  setShowVersionHistory(true);
                  setShowReviewSidebar(false);
                  setShowAIChat(false);
                }}
                className="h-8 w-8"
                title="History"
              >
                <History className="h-4 w-4" />
              </Button>
              
              {(approvals.length > 0 || hasPendingApproval || wasRecentlyRejected) && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setSidebarCollapsed(false);
                    setShowReviewSidebar(true);
                    setShowVersionHistory(false);
                    setShowAIChat(false);
                  }}
                  className={`h-8 w-8 ${
                    hasPendingApproval && isReviewer
                      ? "border-amber-500/50 text-amber-700 dark:text-amber-400"
                      : wasRecentlyRejected
                      ? "border-red-500/50 text-red-700 dark:text-red-400"
                      : ""
                  }`}
                  title="Review"
                >
                  <ClipboardCheck className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Export dialog ── */}
      <RFPDocumentExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        document={doc}
        orgId={orgId}
        htmlContent={htmlContent}
      />

      {/* ── Version Diff View (full screen overlay) ── */}
      {showDiffView && diffVersions && (
        <VersionDiffView
          projectId={projectId}
          opportunityId={opportunityId}
          documentId={documentId}
          orgId={orgId}
          fromVersion={diffVersions.from}
          toVersion={diffVersions.to}
          onClose={() => {
            setShowDiffView(false);
            setDiffVersions(null);
          }}
          onCherryPick={handleCherryPick}
          onRevertToOlder={(version) => {
            setShowDiffView(false);
            setRevertVersion(version);
          }}
        />
      )}

      {/* ── Revert Confirmation Dialog ── */}
      <RevertConfirmDialog
        isOpen={!!revertVersion}
        onClose={() => setRevertVersion(null)}
        version={revertVersion}
        onConfirm={handleRevertConfirm}
        isLoading={isReverting}
      />

      {/* ── Cherry-Pick Confirmation Dialog ── */}
      <CherryPickConfirmDialog
        isOpen={!!cherryPickData}
        onClose={() => setCherryPickData(null)}
        selectedCount={cherryPickData?.selectedCount ?? 0}
        sourceVersion={cherryPickData?.sourceVersion ?? 0}
        previewHtml={cherryPickData?.mergedHtml ?? ''}
        onConfirm={handleCherryPickConfirm}
        isLoading={isCherryPicking}
        onGoBack={handleGoBackToSelection}
      />
    </div>
  );
};
