'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import {
  ArrowLeft,
  Trophy,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { OpportunityProvider, useOpportunityContext } from './opportunity-context';
import { OpportunityHeader } from './opportunity-header';
import { AssigneeSelector } from './AssigneeSelector';
import { OpportunitySolicitationDocuments } from './opportunity-attachments';
import { OpportunityRFPDocuments } from './opportunity-rfp-documents';
import { OpportunityChatDialog } from './OpportunityChatDialog';
import { PhysicalSubmissionBanner } from './PhysicalSubmissionBanner';
import { ExecutiveBriefView } from '@/components/brief/ExecutiveBriefView';
import { QuestionsProvider } from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';
import { OpportunityOutcomeSummary } from './opportunity-outcome-summary';
import { DebriefingCard } from '@/components/debriefing';
import { FOIARequestCard, FoiaAutomationCard } from '@/components/foia';
import { OpportunityContextPanel } from './opportunity-context-panel';
import { useCurrentOrganization } from '@/context/organization-context';
import { useQuestionFiles } from '@/lib/hooks/use-question-file';
import { saveSelectedOpportunity } from '@/lib/utils/opportunity-selection';
import {
  SubmitProposalButton,
  SubmissionHistoryCard,
  ComplianceReport,
} from '@/features/proposal-submission';
import { RequiredFormsList } from '@/features/required-forms';
import { ComplianceReviewPanel } from '@/features/compliance-review';
import { SolutionPlanPanel } from '@/features/solution-plan';
import { OpportunityApprovalPanel } from '@/features/opportunity-approval';
import { RelatedRfpsSection } from '@/features/related-rfp';
import { OpportunityProgressBar } from '@/features/opportunity-progress';
import PermissionWrapper from '@/components/permission-wrapper';

interface OpportunityViewProps {
  projectId: string;
  oppId: string;
  className?: string;
}

// ─── Section Divider ──────────────────────────────────────────────────────────

interface SectionDividerProps {
  icon: React.ReactNode;
  title: string;
  muted?: boolean;
}

const SectionDivider = ({ icon, title, muted = false }: SectionDividerProps) => (
  <div className="flex items-center gap-3 pt-2">
    <div className={cn(
      'flex items-center gap-2',
      muted ? 'text-muted-foreground' : 'text-foreground',
    )}>
      {icon}
      <h2 className={cn(
        'text-base font-semibold whitespace-nowrap',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}>
        {title}
      </h2>
    </div>
    <div className="h-px flex-1 bg-border" />
  </div>
);

// ─── Main Content ─────────────────────────────────────────────────────────────

/**
 * Opportunity page content — composed of focused, self-contained Card sections.
 * Each section reads shared data from OpportunityContext.
 *
 * Layout (follows the working flow):
 * 1. Header — opportunity details, badges, dates
 * 2. Solicitation Documents — the inputs everything else builds on
 * 3. Analysis & Solution Plan — brief and plan generated from the documents
 * 4. Required Forms / RFP Documents / Context & Knowledge Base
 * 5. Submission — compliance report, submit button, history
 * 6. Post-Award — outcome, debriefing, FOIA
 */
// ─── Smart Polling ────────────────────────────────────────────────────────

const PENDING_STATUSES = new Set([
  'GENERATING', 'PROCESSING', 'TEXTRACT_RUNNING', 'TEXT_READY', 'UPLOADED',
]);

const FAST_INTERVAL = 5_000;
const SLOW_INTERVAL = 30_000;
const MAX_UNCHANGED_RELOADS = 3;

/**
 * Smart polling hook for the opportunity view.
 * - 5s interval if any document/file is in a pending state
 * - 30s interval if everything is complete
 * - Stops polling after 3 consecutive unchanged reloads
 */
const useSmartPolling = (orgId: string, projectId: string, oppId: string) => {
  const { mutate: globalMutate } = useSWRConfig();
  const unchangedCountRef = useRef(0);
  const lastSnapshotRef = useRef('');
  const [isPolling, setIsPolling] = useState(true);

  const revalidateAll = useCallback(() => {
    globalMutate(
      (key: unknown) =>
        typeof key === 'string' &&
        (key.includes('/rfp-document/') || key.includes('/questionfile/') || key.includes('/opportunity/')),
    );
  }, [globalMutate]);

  useEffect(() => {
    if (!isPolling || !orgId || !projectId || !oppId) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = () => {
      revalidateAll();

      // Check DOM for status indicators to determine interval
      const statusElements = document.querySelectorAll('[data-doc-status]');
      const statuses = Array.from(statusElements).map((el) => el.getAttribute('data-doc-status') ?? '');
      const hasPending = statuses.some((s) => PENDING_STATUSES.has(s.toUpperCase()));

      // Build snapshot for change detection
      const snapshot = statuses.sort().join(',');
      if (snapshot === lastSnapshotRef.current) {
        unchangedCountRef.current += 1;
      } else {
        unchangedCountRef.current = 0;
        lastSnapshotRef.current = snapshot;
      }

      // Stop polling after MAX_UNCHANGED_RELOADS with no changes (only when stable)
      if (!hasPending && unchangedCountRef.current >= MAX_UNCHANGED_RELOADS) {
        setIsPolling(false);
        return;
      }

      const interval = hasPending ? FAST_INTERVAL : SLOW_INTERVAL;
      timeoutId = setTimeout(poll, interval);
    };

    timeoutId = setTimeout(poll, FAST_INTERVAL);
    return () => clearTimeout(timeoutId);
  }, [isPolling, orgId, projectId, oppId, revalidateAll]);

  const resumePolling = useCallback(() => {
    unchangedCountRef.current = 0;
    lastSnapshotRef.current = '';
    setIsPolling(true);
  }, []);

  return { isPolling, resumePolling };
};

// ─── Main Content Component ──────────────────────────────────────────────

const OpportunityContent = ({ className }: { className?: string }) => {
  const { projectId, oppId, orgId, opportunity, isLoading, refetch } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id;
  // AI Compliance Review is a single-org (Horus Technology) feature, gated by the
  // org-level enableComplianceReview flag — same pattern as Generate POC.
  const complianceReviewEnabled = !!currentOrganization?.enableComplianceReview;
  // Solution Plan ("Source of Truth") ships behind the org-level
  // enableSolutionPlan flag until Release 3 flips gating on per org.
  const solutionPlanEnabled = !!currentOrganization?.enableSolutionPlan;
  // Related RFPs (HOR-2610) auto-discover from the issuing agency — HigherGov opps only.
  const isHigherGov = !!opportunity?.higherGovOppKey;
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Generation actions (solution plan, POC) need at least one solicitation
  // document; the executive brief computes this itself. Treat "still loading" as
  // present so buttons don't flash disabled — the backend rejects generation
  // without documents anyway.
  const { items: solicitationFiles, isLoading: isLoadingSolicitationFiles } =
    useQuestionFiles(projectId, { oppId });
  const hasSolicitationDocs =
    isLoadingSolicitationFiles || solicitationFiles.some((f) => f.status !== 'DELETED');

  // Smart auto-reload: 5s if pending items, 30s if stable, stops after 3 unchanged
  useSmartPolling(orgId, projectId, oppId);
  // Outcome now lives on the opportunity itself (status + jurisdiction/state).
  const outcome = opportunity;

  // Save oppId to session storage so other pages (Questions, Brief, etc.)
  // use this opportunity by default when navigating from this page
  useEffect(() => {
    if (projectId && oppId) {
      saveSelectedOpportunity(projectId, oppId);
    }
  }, [projectId, oppId]);

  const backUrl = navOrgId
    ? `/organizations/${navOrgId}/projects/${projectId}/opportunities`
    : '#';

  return (
    <div className={cn('space-y-6', className)}>
      {/* Back Navigation + Assignee Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2">
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
            Back to Opportunities
          </Link>
        </Button>
        
        {orgId && projectId && oppId && (
          <AssigneeSelector
            orgId={orgId}
            projectId={projectId}
            oppId={oppId}
            currentAssigneeId={opportunity?.assigneeId ?? undefined}
            currentAssigneeName={opportunity?.assigneeName ?? undefined}
            onAssigned={refetch}
            showLabel
            size="sm"
          />
        )}
      </div>

      {/* Opportunity Header */}
      <OpportunityHeader hasSolicitationDocs={hasSolicitationDocs} />

      {/* Reviewer approve/reject panel — only renders for the assigned reviewer */}
      <OpportunityApprovalPanel orgId={orgId} projectId={projectId} opportunityId={oppId} onResolved={refetch} />

      {/* Package-preparation progress bar (retires the old "Jump to" chip row) */}
      <OpportunityProgressBar />

      {/* ── Solicitation Documents (first — everything below builds on them) ── */}
      <section id="solicitation-documents" className="scroll-mt-4">
        <OpportunitySolicitationDocuments onAskAI={() => setIsChatOpen(true)} />
      </section>

      {/* ── Opportunity Analysis ─────────────────────────────────────── */}
      <section id="executive-brief" className="scroll-mt-4">
        <QuestionsProvider projectId={projectId} opportunityId={oppId}>
          <ExecutiveBriefView
            projectId={projectId}
            opportunityId={oppId}
            title="Opportunity Analysis"
            generateLabel="Analyze Opportunity"
          />
        </QuestionsProvider>
      </section>

      {/* ── Solution Plan (Source of Truth, org-flagged) ──────────────── */}
      {solutionPlanEnabled && (
        <section id="solution-plan" className="scroll-mt-4">
          <SolutionPlanPanel
            orgId={orgId}
            projectId={projectId}
            opportunityId={oppId}
            hasSolicitationDocs={hasSolicitationDocs}
          />
        </section>
      )}

      {/* ── Required Forms (separated from solicitation docs) ────────── */}
      <section id="required-forms" className="scroll-mt-4">
        <RequiredFormsList orgId={orgId} projectId={projectId} opportunityId={oppId} />
      </section>

      {/* ── RFP Documents ─────────────────────────────────────────────── */}
      <section id="rfp-documents" className="scroll-mt-4">
        <OpportunityRFPDocuments />
      </section>

      {/* ── Related RFPs (HigherGov-sourced opps only) ─────────────────── */}
      {isHigherGov && (
        <section id="related-rfps" className="scroll-mt-4">
          <RelatedRfpsSection orgId={orgId} projectId={projectId} oppId={oppId} />
        </section>
      )}

      {/* ── Context & Knowledge Base ───────────────────────────────────── */}
      <section className="scroll-mt-4">
        <OpportunityContextPanel />
      </section>

      {/* ── AI Compliance Review (single-org feature) ──────────────────── */}
      {complianceReviewEnabled && (
        <section id="ai-compliance-review" className="space-y-4 scroll-mt-4">
          <SectionDivider
            icon={<Sparkles className="h-4 w-4" />}
            title="AI Compliance Review"
          />
          <ComplianceReviewPanel orgId={orgId} projectId={projectId} oppId={oppId} />
        </section>
      )}

      {/* ── Submission & Compliance ────────────────────────────────────── */}
      <section id="submission-compliance" className="space-y-4 scroll-mt-4">
        <SectionDivider
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Submission & Compliance"
        />
        <PhysicalSubmissionBanner
          orgId={orgId}
          projectId={projectId}
          oppId={oppId}
          opportunity={opportunity}
          isLoading={isLoading}
          refetch={refetch}
        />
        <ComplianceReport orgId={orgId} projectId={projectId} oppId={oppId} />
        <div className="flex justify-end">
          <PermissionWrapper requiredPermission="proposal:create">
            <SubmitProposalButton
              orgId={orgId}
              projectId={projectId}
              oppId={oppId}
            />
          </PermissionWrapper>
        </div>
        <SubmissionHistoryCard orgId={orgId} projectId={projectId} oppId={oppId} />
      </section>

      {/* ── Post-Award ─────────────────────────────────────────────────── */}
      <section id="post-award" className="space-y-4 scroll-mt-4">
        <SectionDivider
          icon={<Trophy className="h-4 w-4" />}
          title="Post-Award"
          muted
        />
        {opportunity && (
          <OpportunityOutcomeSummary
            opportunity={opportunity}
            orgId={orgId}
            projectId={projectId}
            oppId={oppId}
            onOutcomeChange={refetch}
          />
        )}
        {/* Debriefs apply to federal awards only. */}
        {outcome?.jurisdiction === 'FEDERAL' && (
          <DebriefingCard
            projectId={projectId}
            orgId={orgId}
            opportunityId={oppId}
            projectOutcomeStatus={outcome?.status}
            solicitationNumber={opportunity?.solicitationNumber ?? undefined}
            contractTitle={opportunity?.title ?? undefined}
          />
        )}
        <FoiaAutomationCard
          orgId={orgId}
          projectId={projectId}
          opportunityId={oppId}
          opportunityStatus={outcome?.status}
        />
        <FOIARequestCard
          projectId={projectId}
          orgId={orgId}
          opportunityId={oppId}
          projectOutcomeStatus={outcome?.status}
          jurisdiction={outcome?.jurisdiction}
          state={outcome?.state ?? undefined}
          agencyName={opportunity?.organizationName ?? undefined}
          solicitationNumber={opportunity?.solicitationNumber ?? undefined}
          contractTitle={opportunity?.title ?? undefined}
        />
      </section>

      {/* ── Floating AI Assistant ─────────────────────────────────────── */}
      <OpportunityChatDialog 
        opportunityId={oppId} 
        orgId={orgId} 
        projectId={projectId}
        open={isChatOpen}
        onOpenChange={setIsChatOpen}
      />
    </div>
  );
};

// ─── Top-Level Wrapper ────────────────────────────────────────────────────────

/**
 * Top-level Opportunity view.
 * Wraps all sections in OpportunityProvider for shared context.
 */
export function OpportunityView({ projectId, oppId, className }: OpportunityViewProps) {
  return (
    <OpportunityProvider projectId={projectId} oppId={oppId}>
      <OpportunityContent className={className} />
    </OpportunityProvider>
  );
}
