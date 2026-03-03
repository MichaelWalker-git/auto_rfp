'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OpportunitySelector } from '@/components/brief/components/OpportunitySelector';
import { QAEngagementProvider } from '@/components/qa-engagement/qa-engagement-context';
import { ClarifyingQuestionsPanel } from '@/components/qa-engagement/ClarifyingQuestionsPanel';
import { EngagementTimeline } from '@/components/qa-engagement/EngagementTimeline';
import { EngagementMetricsCard } from '@/components/qa-engagement/EngagementMetricsCard';
import { LogInteractionForm } from '@/components/qa-engagement/LogInteractionForm';
import { useCurrentOrganization } from '@/context/organization-context';
import { getSelectedOpportunity, saveSelectedOpportunity } from '@/lib/utils/opportunity-selection';
import type { OpportunityItem } from '@auto-rfp/core';

interface QAEngagementPageContentProps {
  orgId: string;
  projectId: string;
  initialOpportunityId?: string;
}

export function QAEngagementPageContent({
  orgId,
  projectId,
  initialOpportunityId,
}: QAEngagementPageContentProps) {
  const router = useRouter();
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id ?? orgId;
  
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(
    initialOpportunityId ?? null
  );

  // Initialize from sessionStorage on mount (client-side only) and update URL
  useEffect(() => {
    if (!initialOpportunityId && typeof window !== 'undefined') {
      const savedOppId = getSelectedOpportunity(projectId);
      if (savedOppId) {
        setSelectedOpportunityId(savedOppId);
        // Update URL with saved selection
        const url = new URL(window.location.href);
        url.searchParams.set('oppId', savedOppId);
        router.replace(url.pathname + url.search, { scroll: false });
      }
    }
  }, [projectId, initialOpportunityId, router]);

  const handleOpportunitySelect = useCallback(
    (oppId: string | null, _opp: OpportunityItem | null) => {
      setSelectedOpportunityId(oppId);
      
      // Save to sessionStorage for persistence across navigation
      if (oppId) {
        saveSelectedOpportunity(projectId, oppId);
      }
      
      // Update URL query param
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (oppId) {
          url.searchParams.set('oppId', oppId);
        } else {
          url.searchParams.delete('oppId');
        }
        router.replace(url.pathname + url.search, { scroll: false });
      }
    },
    [projectId, router]
  );

  return (
    <div className="space-y-6 p-6 w-full">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-indigo-500" />
            Q&A Engagement Tools
          </h1>
          <p className="text-muted-foreground mt-1">
            Build relationships with contracting officers during the Q&A period
          </p>
        </div>
        <div className="flex-1 max-w-md">
          <OpportunitySelector
            projectId={projectId}
            orgId={navOrgId}
            selectedOpportunityId={selectedOpportunityId}
            onSelect={handleOpportunitySelect}
            disabled={false}
          />
        </div>
      </div>

      {/* Content - only show when opportunity is selected */}
      {selectedOpportunityId ? (
        <QAEngagementProvider
          orgId={navOrgId}
          projectId={projectId}
          opportunityId={selectedOpportunityId}
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main content - 2 columns */}
            <div className="lg:col-span-2 space-y-6">
              <ClarifyingQuestionsPanel />
              <LogInteractionForm />
              <EngagementTimeline />
            </div>

            {/* Sidebar - 1 column */}
            <div className="space-y-6">
              <EngagementMetricsCard />
              
              {/* Tips Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <HelpCircle className="h-4 w-4 text-indigo-500" />
                    Q&A Best Practices
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    <strong>Build relationships:</strong> The Q&A period is your chance to 
                    get closer to the contracting officer who will review your proposal.
                  </p>
                  <p>
                    <strong>Ask thoughtful questions:</strong> Well-crafted clarifying questions 
                    show you've carefully read the RFP and understand the requirements.
                  </p>
                  <p>
                    <strong>Engage consistently:</strong> The more you engage, the more 
                    likely the customer will want to work with you.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </QAEngagementProvider>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">Select an Opportunity</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Choose an opportunity from the dropdown above to view and manage 
              clarifying questions and contracting officer engagement.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
