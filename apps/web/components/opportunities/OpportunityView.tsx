'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  MessageSquare,
  HelpCircle,
  FileText,
  Trophy,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { OpportunityProvider, useOpportunityContext } from './opportunity-context';
import { OpportunityHeader } from './opportunity-header';
import { OpportunitySolicitationDocuments } from './opportunity-attachments';
import { OpportunityRFPDocuments } from './opportunity-rfp-documents';
import { OpportunityActionCard } from './opportunity-action-card';
import { ProjectOutcomeCard } from '@/components/project-outcome/ProjectOutcomeCard';
import { DebriefingCard } from '@/components/debriefing';
import { FOIARequestCard } from '@/components/foia/FOIARequestCard';
import { OpportunityContextPanel } from './opportunity-context-panel';
import { useCurrentOrganization } from '@/context/organization-context';
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
const OpportunityContent = ({ className }: { className?: string }) => {
  const { projectId, oppId, orgId } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id;

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
      {/* Back Navigation */}
      <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2">
        <Link href={backUrl}>
          <ArrowLeft className="h-4 w-4" />
          Back to Opportunities
        </Link>
      </Button>

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
      </section>

      {/* ── Documents ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionDivider
          icon={<FileText className="h-4 w-4" />}
          title="Documents"
        />
        <div className="space-y-4">
          <OpportunitySolicitationDocuments />
          <OpportunityRFPDocuments />
        </div>
      </section>

      {/* ── Context & Knowledge Base ───────────────────────────────────── */}
      <section className="space-y-3">
        <OpportunityContextPanel />
      </section>

      {/* ── Submission & Compliance ────────────────────────────────────── */}
      <section className="space-y-4">
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
      <section className="space-y-3">
        <SectionDivider
          icon={<Trophy className="h-4 w-4" />}
          title="Post-Award"
          muted
        />
        <div className="space-y-4">
          <ProjectOutcomeCard projectId={projectId} orgId={orgId} opportunityId={oppId} />
          <DebriefingCard projectId={projectId} orgId={orgId} projectOutcomeStatus="LOST" />
          <FOIARequestCard projectId={projectId} orgId={orgId} projectOutcomeStatus="LOST" />
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
