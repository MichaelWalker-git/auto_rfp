'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { QAEngagementProvider, useQAEngagementContext } from './qa-engagement-context';
import { ClarifyingQuestionsPanel } from './ClarifyingQuestionsPanel';
import { EngagementTimeline } from './EngagementTimeline';
import { EngagementMetricsCard } from './EngagementMetricsCard';
import { LogInteractionForm } from './LogInteractionForm';

interface QAEngagementViewProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  className?: string;
}

/**
 * Q&A Engagement page content — helps build relationships with contracting officers
 * through the Q&A period of RFP responses.
 *
 * Layout:
 * 1. Metrics Card — engagement statistics, response rates
 * 2. Clarifying Questions — AI-generated questions with status tracking
 * 3. Engagement Timeline — chronological history of CO interactions
 * 4. Log Interaction — form to manually log interactions
 */
function QAEngagementContent({ className }: { className?: string }) {
  const { orgId, projectId, opportunityId } = useQAEngagementContext();

  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2">
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
            Back to Opportunity
          </Link>
        </Button>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Q&A Period Engagement</h1>
        <p className="text-muted-foreground">
          Build relationships with contracting officers through intelligent clarifying questions
          and tracked interactions.
        </p>
      </div>

      <EngagementMetricsCard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ClarifyingQuestionsPanel />
        <div className="space-y-6">
          <LogInteractionForm />
          <EngagementTimeline />
        </div>
      </div>
    </div>
  );
}

/**
 * Top-level Q&A Engagement view.
 * Wraps all sections in QAEngagementProvider for shared context.
 */
export function QAEngagementView({ orgId, projectId, opportunityId, className }: QAEngagementViewProps) {
  return (
    <QAEngagementProvider orgId={orgId} projectId={projectId} opportunityId={opportunityId}>
      <QAEngagementContent className={className} />
    </QAEngagementProvider>
  );
}
