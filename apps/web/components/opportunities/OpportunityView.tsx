'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { OpportunityProvider, useOpportunityContext } from './opportunity-context';
import { OpportunityHeader } from './opportunity-header';
import { AssigneeSelector } from './AssigneeSelector';
import { RequirementFlagRow } from './RequirementFlagRow';
import {
  OPPORTUNITY_TAB_VALUES,
  OPPORTUNITY_TAB_LABELS,
  DEFAULT_OPPORTUNITY_TAB,
  type OpportunityTabKey,
} from './opportunity-tabs';
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
import { RelatedRfpsSection, useRelatedRfps } from '@/features/related-rfp';
import {
  ProgressTabStrip,
  navigateToStep,
  useOpportunityProgress,
  evaluateRelated,
  type TabHeaderModel,
  type ProgressStep,
  type NavigationDescriptor,
  type OutcomeEvaluation,
  type RelatedEvaluation,
} from '@/features/opportunity-progress';
import PermissionWrapper from '@/components/permission-wrapper';

interface OpportunityViewProps {
  projectId: string;
  oppId: string;
  className?: string;
}

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

  return { isPolling };
};

// ─── Non-step tab popovers ────────────────────────────────────────────────

const OutcomePopover = ({ outcome }: { outcome: OutcomeEvaluation }) => (
  <div className="space-y-1">
    <p className="text-sm font-semibold text-foreground">Outcome</p>
    <p className="text-xs text-muted-foreground">
      {outcome.isTerminal
        ? `This opportunity is marked ${outcome.label}.`
        : 'No final decision has been recorded yet.'}
    </p>
  </div>
);

const RelatedPopover = ({ related }: { related: RelatedEvaluation }) => (
  <div className="space-y-1">
    <p className="text-sm font-semibold text-foreground">Related opportunities</p>
    <p className="text-xs text-muted-foreground">
      {related.count === 0
        ? 'No related opportunities found.'
        : `${related.label} to this solicitation.`}
    </p>
  </div>
);

// ─── Tab panel (lazy keep-alive) ──────────────────────────────────────────

interface TabPanelProps {
  tabKey: OpportunityTabKey;
  activeKey: OpportunityTabKey;
  opened: boolean;
  children: React.ReactNode;
}

/**
 * A tab body that mounts on first open and stays mounted (CSS-hidden) for the
 * rest of the visit — not Radix's default unmount, not `forceMount` of every tab.
 */
const TabPanel = ({ tabKey, activeKey, opened, children }: TabPanelProps) => {
  const isActive = tabKey === activeKey;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${tabKey}`}
      aria-labelledby={`tab-${tabKey}`}
      hidden={!isActive}
      className="space-y-6 pt-6"
    >
      {opened ? children : null}
    </div>
  );
};

// ─── Main Content Component ──────────────────────────────────────────────

/**
 * Opportunity detail page (ADR 0001) — a persistent header (title/agency, back
 * button, assignee, requirement flag chips), the approval banner, a progress-driven
 * tab strip, and lazily-mounted tab bodies. Existing panels are moved into tab
 * bodies unchanged; `OpportunityProvider` and smart polling are retained.
 */
const OpportunityContent = ({ className }: { className?: string }) => {
  const { projectId, oppId, orgId, opportunity, isLoading, refetch } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id;
  // AI Compliance Review + Solution Plan are org-flagged features.
  const complianceReviewEnabled = !!currentOrganization?.enableComplianceReview;
  const solutionPlanEnabled = !!currentOrganization?.enableSolutionPlan;
  // Related RFPs (HOR-2610) auto-discover from the issuing agency — HigherGov opps only.
  const isHigherGov = !!opportunity?.higherGovOppKey;
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Generation actions need at least one solicitation document; treat "loading"
  // as present so buttons don't flash disabled.
  const { items: solicitationFiles, isLoading: isLoadingSolicitationFiles } =
    useQuestionFiles(projectId, { oppId });
  const hasSolicitationDocs =
    isLoadingSolicitationFiles || solicitationFiles.some((f) => f.status !== 'DELETED');

  // Smart auto-reload: 5s if pending items, 30s if stable, stops after 3 unchanged
  useSmartPolling(orgId, projectId, oppId);

  // Progress engine drives the tab headers (metric + status icon + popover).
  const { steps, isLoading: isProgressLoading, outcome } = useOpportunityProgress();

  // Related count gates + labels the Related tab; only fetched for HigherGov opps.
  const { items: relatedItems } = useRelatedRfps({
    orgId,
    projectId,
    oppId: isHigherGov ? oppId : '',
  });
  const related = useMemo(() => evaluateRelated(relatedItems), [relatedItems]);

  // Save oppId to session storage so other pages default to this opportunity.
  useEffect(() => {
    if (projectId && oppId) {
      saveSelectedOpportunity(projectId, oppId);
    }
  }, [projectId, oppId]);

  const backUrl = navOrgId
    ? `/organizations/${navOrgId}/projects/${projectId}/opportunities`
    : '#';

  // ── URL tab state (nuqs) ──────────────────────────────────────────────────
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(OPPORTUNITY_TAB_VALUES).withDefault(DEFAULT_OPPORTUNITY_TAB),
  );

  // A step navigates to its owning tab via `navigation.href` (the tab key).
  const stepByTab = useMemo(() => {
    const map = new Map<string, ProgressStep>();
    for (const step of steps) {
      if (step.navigation.kind === 'route') map.set(step.navigation.href, step);
    }
    return map;
  }, [steps]);

  // Visible tab set (FR1.5/FR1.6): always-on tabs plus the conditionally-shown
  // ones. Solution plan / Required forms / Review track their progress step's
  // presence (the engine hides those steps under the same conditions); Related is
  // HigherGov + non-empty. Progress steps are not 1:1 with tabs.
  const visibleTabs = useMemo<OpportunityTabKey[]>(
    () =>
      OPPORTUNITY_TAB_VALUES.filter((key) => {
        switch (key) {
          case 'solution-plan':
            return stepByTab.has('solution-plan');
          case 'required-forms':
            return stepByTab.has('required-forms');
          case 'review':
            return stepByTab.has('review');
          case 'related':
            return isHigherGov && related.count > 0;
          default:
            return true;
        }
      }),
    [stepByTab, isHigherGov, related.count],
  );

  // A `?tab=` pointing at a hidden/gated tab falls back to Details (validate
  // against the *visible* set, not just the literal union).
  const effectiveTab = visibleTabs.includes(tab) ? tab : DEFAULT_OPPORTUNITY_TAB;

  // Lazy keep-alive: a body mounts on first open and stays mounted afterwards.
  const [opened, setOpened] = useState<Set<OpportunityTabKey>>(() => new Set([effectiveTab]));
  useEffect(() => {
    setOpened((prev) => {
      if (prev.has(effectiveTab)) return prev;
      const next = new Set(prev);
      next.add(effectiveTab);
      return next;
    });
  }, [effectiveTab]);

  const selectTab = useCallback(
    (key: string) => {
      void setTab(key as OpportunityTabKey);
    },
    [setTab],
  );

  const handleNavigate = useCallback(
    (nav: NavigationDescriptor) => navigateToStep(nav, selectTab),
    [selectTab],
  );

  // Build the tab-strip header models (label + metric + popover) for visible tabs.
  const tabModels = useMemo<TabHeaderModel[]>(
    () =>
      visibleTabs.map((key) => {
        const base = {
          key,
          label: OPPORTUNITY_TAB_LABELS[key],
          navigation: { kind: 'route', href: key } as NavigationDescriptor,
        };
        if (key === 'outcome') {
          return { ...base, metricText: outcome.label, popover: <OutcomePopover outcome={outcome} /> };
        }
        if (key === 'related') {
          return { ...base, metricText: related.label, popover: <RelatedPopover related={related} /> };
        }
        return { ...base, step: stepByTab.get(key) };
      }),
    [visibleTabs, stepByTab, outcome, related],
  );

  const renderBody = (key: OpportunityTabKey): React.ReactNode => {
    switch (key) {
      case 'details':
        return (
          <>
            <OpportunityHeader hasSolicitationDocs={hasSolicitationDocs} />
            <OpportunityContextPanel />
            <OpportunitySolicitationDocuments onAskAI={() => setIsChatOpen(true)} />
          </>
        );
      case 'analysis':
        return (
          <QuestionsProvider projectId={projectId} opportunityId={oppId}>
            <ExecutiveBriefView
              projectId={projectId}
              opportunityId={oppId}
              title="Opportunity Analysis"
              generateLabel="Analyze Opportunity"
            />
          </QuestionsProvider>
        );
      case 'solution-plan':
        return (
          <SolutionPlanPanel
            orgId={orgId}
            projectId={projectId}
            opportunityId={oppId}
            hasSolicitationDocs={hasSolicitationDocs}
          />
        );
      case 'required-forms':
        return <RequiredFormsList orgId={orgId} projectId={projectId} opportunityId={oppId} />;
      case 'rfp-documents':
        return <OpportunityRFPDocuments />;
      case 'review':
        return <ComplianceReviewPanel orgId={orgId} projectId={projectId} oppId={oppId} />;
      case 'compliance':
        return (
          <>
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
                <SubmitProposalButton orgId={orgId} projectId={projectId} oppId={oppId} />
              </PermissionWrapper>
            </div>
            <SubmissionHistoryCard orgId={orgId} projectId={projectId} oppId={oppId} />
          </>
        );
      case 'outcome':
        return (
          <>
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
            {opportunity?.jurisdiction === 'FEDERAL' && (
              <DebriefingCard
                projectId={projectId}
                orgId={orgId}
                opportunityId={oppId}
                projectOutcomeStatus={opportunity?.status}
                solicitationNumber={opportunity?.solicitationNumber ?? undefined}
                contractTitle={opportunity?.title ?? undefined}
              />
            )}
            <FoiaAutomationCard
              orgId={orgId}
              projectId={projectId}
              opportunityId={oppId}
              opportunityStatus={opportunity?.status}
            />
            <FOIARequestCard
              projectId={projectId}
              orgId={orgId}
              opportunityId={oppId}
              projectOutcomeStatus={opportunity?.status}
              jurisdiction={opportunity?.jurisdiction}
              state={opportunity?.state ?? undefined}
              agencyName={opportunity?.organizationName ?? undefined}
              solicitationNumber={opportunity?.solicitationNumber ?? undefined}
              contractTitle={opportunity?.title ?? undefined}
            />
          </>
        );
      case 'related':
        return <RelatedRfpsSection orgId={orgId} projectId={projectId} oppId={oppId} />;
      default:
        return null;
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* ── Persistent header (visible on every tab) ─────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2 gap-2">
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

        {opportunity && (
          <div>
            <h1 className="text-lg font-semibold leading-tight text-foreground break-words">
              {opportunity.title}
            </h1>
            <p className="text-sm text-muted-foreground break-words">
              {opportunity.organizationName ?? '—'}
            </p>
          </div>
        )}

        <RequirementFlagRow
          opportunity={opportunity}
          onSelectTab={selectTab}
          visibleTabs={visibleTabs}
        />
      </div>

      {/* ── Approval banner (self-gates to the assigned reviewer) ────────────── */}
      <OpportunityApprovalPanel
        orgId={orgId}
        projectId={projectId}
        opportunityId={oppId}
        onResolved={refetch}
      />

      {/* ── Progress-driven tab strip ────────────────────────────────────────── */}
      <ProgressTabStrip
        tabs={tabModels}
        activeKey={effectiveTab}
        onNavigate={handleNavigate}
        isLoading={isProgressLoading}
      />

      {/* ── Tab bodies (lazy keep-alive) ─────────────────────────────────────── */}
      {visibleTabs.map((key) => (
        <TabPanel key={key} tabKey={key} activeKey={effectiveTab} opened={opened.has(key)}>
          {renderBody(key)}
        </TabPanel>
      ))}

      {/* ── Floating AI Assistant (available from every tab) ─────────────────── */}
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
