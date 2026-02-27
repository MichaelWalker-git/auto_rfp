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
import { FOIARequestCard } from '@/components/foia/FOIARequestCard';
import { OpportunityContextPanel } from './opportunity-context-panel';
import { useCurrentOrganization } from '@/context/organization-context';
import { saveSelectedOpportunity } from '@/lib/utils/opportunity-selection';

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
    <div className={cn('space-y-6', className)}>
      <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2">
        <Link href={backUrl}>
          <ArrowLeft className="h-4 w-4" />
          Back to Opportunities
        </Link>
      </Button>
      <OpportunityHeader />

      {/* Questions & Answers Card */}
      {navOrgId && (
        <OpportunityActionCard
          icon={HelpCircle}
          iconColor="text-blue-500"
          title="Questions & Answers"
          description="View and answer RFP questions for this opportunity"
          buttonText="View Questions"
          href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/questions`}
        />
      )}

      {/* Q&A Engagement Card */}
      {navOrgId && (
        <OpportunityActionCard
          icon={MessageSquare}
          iconColor="text-indigo-500"
          title="Q&A Period Engagement"
          description="Build relationships with contracting officers through clarifying questions"
          buttonText="Manage Q&A Engagement"
          href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/qa-engagement`}
        />
      )}

      <OpportunitySolicitationDocuments />
      <OpportunityRFPDocuments />
      <OpportunityContextPanel />
      <ProjectOutcomeCard projectId={projectId} orgId={orgId} opportunityId={oppId} />
      <FOIARequestCard projectId={projectId} orgId={orgId} projectOutcomeStatus="LOST" />
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