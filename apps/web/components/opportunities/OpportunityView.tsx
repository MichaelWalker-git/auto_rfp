'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import {
  ArrowLeft,
  ClipboardList,
  HelpCircle,
  Trophy,
  ShieldCheck,
  Paperclip,
  FileEdit,
  Sparkles,
  Link2,
  Info,
  BarChart3,
  FileText,
  Upload,
  CheckCircle,
  FileSearch,
  MessageSquare,
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
import PermissionWrapper from '@/components/permission-wrapper';
import { TabBar } from './opportunity-tabs/TabBar';

// Import existing components we need to render in different tabs
import { OpportunityHeaderEdit } from './opportunity-header/OpportunityHeaderEdit';
import { OpportunityStatusBadge } from './opportunity-status-badge';
import { FoiaAutomationBadge } from '@/components/foia';
import { formatDateTime } from './opportunity-helpers';

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

interface TabData {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const TAB_DATA: TabData[] = [
  { id: 'details', label: 'Details', icon: <Info className="h-3.5 w-3.5" /> },
  { id: 'analysis', label: 'Analysis', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: 'documents', label: 'Output Documents', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'submission', label: 'Submission', icon: <Upload className="h-3.5 w-3.5" /> },
  { id: 'result', label: 'Result', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  { id: 'foia', label: 'FOIA', icon: <FileSearch className="h-3.5 w-3.5" /> },
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-3.5 w-3.5" /> },
];

/**
 * Opportunity page content — composed of focused, self-contained Card sections.
 * Each section reads shared data from OpportunityContext.
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
  // AI Compliance Review is a single-org (Horus Technology) feature, gated by the
  // org-level enableComplianceReview flag — same pattern as Generate POC.
  const complianceReviewEnabled = !!currentOrganization?.enableComplianceReview;
  // Solution Plan ("Source of Truth") ships behind the org-level
  // enableSolutionPlan flag until Release 3 flips gating on per org.
  const solutionPlanEnabled = !!currentOrganization?.enableSolutionPlan;
  // Related RFPs (HOR-2610) auto-discover from the issuing agency — HigherGov opps only.
  const isHigherGov = !!opportunity?.higherGovOppKey;
  const hiddenSectionIds = [
    ...(complianceReviewEnabled ? [] : ['ai-compliance-review']),
    ...(solutionPlanEnabled ? [] : ['solution-plan']),
    ...(isHigherGov ? [] : ['related-rfps']),
  ];
  const [activeTab, setActiveTab] = useState('details');
  const [isChatOpen, setIsChatOpen] = useState(false);

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

  const backUrl = '/';  // This will be fixed to use navOrgId in actual implementation

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
      <OpportunityHeader />

      {/* TabBar */}
      <TabBar
        tabs={TAB_DATA}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="max-w-screen-lg mx-auto"
      />

      {/* Central Tab Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Area */}
        <div className="lg:col-span-2">
          <div className="flex flex-col gap-6">
            {activeTab === 'details' && (
              // Render opportunity details in the main content area
              <div className="space-y-8">
                <section className="scroll-mt-4">
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold">Opportunity Details</h2>
                    <div className="flex flex-wrap gap-1.5 items-center overflow-hidden">
                      {opportunity?.status && (
                        <OpportunityStatusBadge
                          status={(opportunity.status as any) ?? 'IDENTIFIED'}
                        />
                      )}
                      <FoiaAutomationBadge state={opportunity?.foiaAutomationState} />
                      <div className="text-sm border rounded-md p-2">
                        <div className="font-medium">Source:</div>
                        <div>{opportunity?.source || '—'}</div>
                      </div>
                      {opportunity?.type && (
                        <div className="text-sm border rounded-md p-2">
                          <div className="font-medium">Type:</div>
                          <div>{opportunity.type}</div>
                        </div>
                      )}
                      {opportunity?.naicsCode && (
                        <div className="text-sm border rounded-md p-2">
                          <div className="font-medium">NAICS:</div>
                          <div>{opportunity.naicsCode}</div>
                        </div>
                      )}
                      {opportunity?.pscCode && (
                        <div className="text-sm border rounded-md p-2">
                          <div className="font-medium">PSC:</div>
                          <div>{opportunity.pscCode}</div>
                        </div>
                      )}
                      {opportunity?.setAside && (
                        <div className="text-sm border rounded-md p-2">
                          <div className="font-medium">Set Aside:</div>
                          <div>{opportunity.setAside}</div>
                        </div>
                      )}
                      {opportunity?.solicitationNumber && (
                        <div className="text-sm border rounded-md p-2">
                          <div className="font-medium">Solicitation:</div>
                          <div>{opportunity.solicitationNumber}</div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="font-medium text-sm mb-1">Posted Date:</div>
                        <div>{formatDateTime(opportunity?.postedDateIso) || '—'}</div>
                      </div>
                      <div>
                        <div className="font-medium text-sm mb-1">Response Deadline:</div>
                        <div>{formatDateTime(opportunity?.responseDeadlineIso) || '—'}</div>
                      </div>
                      {(opportunity?.decisionDateIso || opportunity?.contractStartDateIso) && (
                        <div>
                          <div className="font-medium text-sm mb-1">Decision/Contract Start:</div>
                          {opportunity?.decisionDateIso ? (
                            <div>Decision: {formatDateTime(opportunity.decisionDateIso)}</div>
                          ) : (
                            <div>Contract Start: {formatDateTime(opportunity?.contractStartDateIso)}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Opportunity Description - This should be part of Details tab */}
                <section className="scroll-mt-4">
                  <div className="prose prose-sm max-w-none text-sm text-muted-foreground leading-relaxed">
                    <p className="mb-2">{opportunity?.description || 'No description available.'}</p>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'analysis' && (
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
            )}

            {activeTab === 'documents' && (
              <>
                {/* Solicitation Documents */}
                <section id="solicitation-documents" className="scroll-mt-4">
                  <OpportunitySolicitationDocuments onAskAI={() => setIsChatOpen(true)} />
                </section>

                {/* Required Forms */}
                <section id="required-forms" className="scroll-mt-4">
                  <RequiredFormsList orgId={orgId} projectId={projectId} opportunityId={oppId} />
                </section>

                {/* RFP Documents */}
                <section id="rfp-documents" className="scroll-mt-4">
                  <OpportunityRFPDocuments />
                </section>
              </>
            )}

            {activeTab === 'submission' && (
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
            )}

            {activeTab === 'result' && (
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
              </section>
            )}

            {activeTab === 'foia' && (
              <section id="foia-section" className="space-y-4 scroll-mt-4">
                <SectionDivider
                  icon={<FileSearch className="h-3.5 w-3.5" />}
                  title="FOIA"
                />
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
            )}
          </div>
        </div>

        {/* Right Side Chat Panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <div className="border rounded-lg p-4 h-fit bg-card shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5" />
                <h3 className="font-semibold">AI Assistant</h3>
              </div>

              {/* Chat content that's currently part of the opportunity context */}
              <div className="text-sm text-muted-foreground">
                <p className="mb-3">
                  Chat with the opportunity documents directly.
                  Ask about solicitations, requirements, response guidelines, etc.
                </p>

                <div className="mb-4">
                  <Button
                    onClick={() => setIsChatOpen(true)}
                    className="w-full text-xs"
                    variant="outline"
                    size="sm"
                  >
                    Open Chat Panel
                  </Button>
                </div>
              </div>
            </div>

            {/* Additional info panels could go here */}
            <div className="border rounded-lg p-4 mt-4 bg-card shadow-sm">
              <h3 className="font-semibold mb-2">Quick Actions</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li className="flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>Create Executive Brief</span>
                </li>
                <li className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Generate Proposal</span>
                </li>
                <li className="flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI Review</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Opportunity Chat Dialog */}
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