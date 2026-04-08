'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import {
  ArrowLeft,
  MessageSquare,
  HelpCircle,
  FileText,
  Trophy,
  ShieldCheck,
  Paperclip,
  FileEdit,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { OpportunityProvider, useOpportunityContext } from './opportunity-context';
import { OpportunityHeader } from './opportunity-header';
import { AssigneeSelector } from './AssigneeSelector';
import { OpportunitySolicitationDocuments } from './opportunity-attachments';
import { OpportunityRFPDocuments } from './opportunity-rfp-documents';
import { OpportunityActionCard } from './opportunity-action-card';
import { ProjectOutcomeCard } from '@/components/project-outcome/ProjectOutcomeCard';
import { DebriefingCard } from '@/components/debriefing';
import { FOIARequestCard } from '@/components/foia/FOIARequestCard';
import { OpportunityContextPanel } from './opportunity-context-panel';
import { useCurrentOrganization } from '@/context/organization-context';
import { useProjectOutcome } from '@/lib/hooks/use-project-outcome';
import { saveSelectedOpportunity } from '@/lib/utils/opportunity-selection';
import {
  SubmitProposalButton,
  SubmissionHistoryCard,
  ComplianceReport,
} from '@/features/proposal-submission';
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

// ─── Section Navigation ───────────────────────────────────────────────────────

interface SectionNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const SECTION_NAV_ITEMS: SectionNavItem[] = [
  { id: 'solicitation-documents', label: 'Solicitations', icon: <Paperclip className="h-3.5 w-3.5" /> },
  { id: 'rfp-documents', label: 'RFP Documents', icon: <FileEdit className="h-3.5 w-3.5" /> },
  { id: 'submission-compliance', label: 'Submission', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  { id: 'post-award', label: 'Post-Award', icon: <Trophy className="h-3.5 w-3.5" /> },
];

const SectionNavigation = () => {
  const handleScrollTo = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <span className="flex items-center gap-1 font-semibold">
        Jump to:
      </span>
      {SECTION_NAV_ITEMS.map((item) => (
        <Button
          key={item.id}
          variant="outline"
          size="sm"
          className="h-7 gap-2 px-2.5"
          onClick={() => handleScrollTo(item.id)}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
    </div>
  );
};

// ─── Main Content ─────────────────────────────────────────────────────────────

/**
 * Opportunity page content — composed of focused, self-contained Card sections.
 * Each section reads shared data from OpportunityContext.
 *
 * Layout:
 * 1. Header — opportunity details, badges, dates
 * 2. Quick Actions — questions, Q&A engagement
 * 3. Documents — solicitation + RFP response documents
 * 4. Context & Knowledge Base
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
  const { projectId, oppId, orgId, opportunity, refetch } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id;

  // Smart auto-reload: 5s if pending items, 30s if stable, stops after 3 unchanged
  useSmartPolling(orgId, projectId, oppId);
  const { outcome } = useProjectOutcome(orgId, projectId, oppId);

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
      <div className="flex items-center justify-between">
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

      {/* Opportunity Header — Hero Section */}
      <OpportunityHeader />

      {/* ── Quick Actions ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionDivider
          icon={<HelpCircle className="h-4 w-4" />}
          title="Quick Actions"
        />
        <div className="grid gap-3 md:grid-cols-2">
          {navOrgId && (
            <OpportunityActionCard
              icon={HelpCircle}
              iconColor="text-blue-600"
              iconBgGradient="from-blue-50 to-blue-100"
              title="Questions & Answers"
              description="View and answer RFP questions for this opportunity"
              buttonText="View Questions"
              href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/questions`}
              variant="compact"
            />
          )}
          {navOrgId && (
            <OpportunityActionCard
              icon={MessageSquare}
              iconColor="text-indigo-600"
              iconBgGradient="from-indigo-50 to-indigo-100"
              title="Q&A Period Engagement"
              description="Build relationships with contracting officers through clarifying questions"
              buttonText="Manage Engagement"
              href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/qa-engagement`}
              variant="compact"
            />
          )}
        </div>
        {/* Section Navigation Buttons */}
        <SectionNavigation />
      </section>

      {/* ── Documents ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionDivider
          icon={<FileText className="h-4 w-4" />}
          title="Documents"
        />
        <div className="space-y-4">
          <div id="solicitation-documents" className="scroll-mt-4">
            <OpportunitySolicitationDocuments />
          </div>
          <div id="rfp-documents" className="scroll-mt-4">
            <OpportunityRFPDocuments />
          </div>
        </div>
      </section>

      {/* ── Context & Knowledge Base ───────────────────────────────────── */}
      <section className="space-y-3">
        <OpportunityContextPanel />
      </section>

      {/* ── Submission & Compliance ────────────────────────────────────── */}
      <section id="submission-compliance" className="space-y-4 scroll-mt-4">
        <SectionDivider
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Submission & Compliance"
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
      <section id="post-award" className="space-y-3 scroll-mt-4">
        <SectionDivider
          icon={<Trophy className="h-4 w-4" />}
          title="Post-Award"
          muted
        />
        <div className="space-y-4">
          <ProjectOutcomeCard projectId={projectId} orgId={orgId} opportunityId={oppId} />
          <DebriefingCard
            projectId={projectId}
            orgId={orgId}
            opportunityId={oppId}
            projectOutcomeStatus={outcome?.status}
            solicitationNumber={opportunity?.solicitationNumber ?? undefined}
            contractTitle={opportunity?.title ?? undefined}
          />
          <FOIARequestCard
            projectId={projectId}
            orgId={orgId}
            opportunityId={oppId}
            projectOutcomeStatus={outcome?.status}
            agencyName={opportunity?.organizationName ?? undefined}
            solicitationNumber={opportunity?.solicitationNumber ?? undefined}
            contractTitle={opportunity?.title ?? undefined}
          />
        </div>
      </section>
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
