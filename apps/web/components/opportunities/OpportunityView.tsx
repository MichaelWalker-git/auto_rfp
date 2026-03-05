'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, HelpCircle } from 'lucide-react';
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
import { ApnRegistrationCard } from '@/features/apn';
import {
  SubmissionChecklist,
  SubmitProposalButton,
  SubmissionHistoryCard,
} from '@/features/proposal-submission';
import PermissionWrapper from '@/components/permission-wrapper';

interface OpportunityViewProps {
  projectId: string;
  oppId: string;
  className?: string;
}

/**
 * Opportunity page content — composed of focused, self-contained Card sections.
 * Each section reads shared data from OpportunityContext.
 *
 * Layout:
 * 1. Header — opportunity details, badges, dates
 * 2. Solicitation Documents — uploaded question files for extraction
 * 3. RFP Documents — generated proposals & uploaded response documents
 * 4. Outcome — win/loss tracking
 * 5. FOIA Requests — competitive intelligence
 */
function OpportunityContent({ className }: { className?: string }) {
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
    <div className={cn('space-y-8', className)}>
      {/* Back Navigation */}
      <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2">
        <Link href={backUrl}>
          <ArrowLeft className="h-4 w-4" />
          Back to Opportunities
        </Link>
      </Button>

      {/* Opportunity Header - Hero Section */}
      <OpportunityHeader />

      {/* APN Registration Status */}
      <ApnRegistrationCard orgId={orgId} projectId={projectId} oppId={oppId} />

      {/* Primary Actions - Prominent Section */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Questions & Answers Card */}
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

          {/* Q&A Engagement Card */}
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
      </div>

      {/* Documents Section - Grouped for Clarity */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <h2 className="text-lg font-semibold text-foreground">Documents</h2>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-4">
          <OpportunitySolicitationDocuments />
          <OpportunityRFPDocuments />
        </div>
      </div>

      {/* Context & Knowledge Base */}
      <OpportunityContextPanel />

      {/* Submission Section - Clear Visual Separation */}
      <div className="space-y-4 pt-4 border-t-2 border-dashed">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <h2 className="text-lg font-semibold text-foreground">Submission</h2>
          <div className="h-px flex-1 bg-border" />
        </div>
        <SubmissionChecklist orgId={orgId} projectId={projectId} oppId={oppId} />
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
      </div>

      {/* Post-Award Section - Only visible after decision */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <h2 className="text-lg font-semibold text-muted-foreground">Post-Award</h2>
          <div className="h-px flex-1 bg-border" />
        </div>
        <ProjectOutcomeCard projectId={projectId} orgId={orgId} opportunityId={oppId} />
        <DebriefingCard projectId={projectId} orgId={orgId} projectOutcomeStatus="LOST" />
        <FOIARequestCard projectId={projectId} orgId={orgId} projectOutcomeStatus="LOST" />
      </div>
    </div>
  );
}

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