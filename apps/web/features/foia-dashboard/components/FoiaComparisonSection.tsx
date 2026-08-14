'use client';

import { ScrollText } from 'lucide-react';
import { useFoiaDashboard } from '@/lib/hooks/use-foia-dashboard';
import { FoiaDocumentsSummary } from './FoiaDocumentsSummary';
import { FoiaOutcomeDonut } from './FoiaOutcomeDonut';
import { FoiaPricingChart } from './FoiaPricingChart';
import { FoiaScoreComparison } from './FoiaScoreComparison';

interface FoiaComparisonSectionProps {
  orgId: string;
}

/**
 * FOIA comparison block on the organization dashboard.
 *
 * Answers the question the FOIA automation was built for — when we lost, how did the
 * winner beat us — using records the agencies themselves released. Until now that data
 * was only visible one opportunity at a time.
 *
 * Not gated: consistent with the rest of this page, and the requirement is that the
 * charts are viewable by all roles. Only opening a released document is restricted, and
 * that check lives in `FoiaDocumentsSummary`.
 *
 * Deliberately outside the page's month range. A FOIA response can arrive months after
 * the outcome it describes, so windowing on either date would hide exactly the rows a
 * reader came for.
 */
export const FoiaComparisonSection = ({ orgId }: FoiaComparisonSectionProps) => {
  const { data, isLoading } = useFoiaDashboard(orgId);
  const dashboard = data?.dashboard;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">FOIA Comparison</h2>
        <span className="text-xs text-muted-foreground">
          All time — released records arrive well after an award
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FoiaOutcomeDonut counts={dashboard?.counts} isLoading={isLoading} />
        <FoiaDocumentsSummary orgId={orgId} dashboard={dashboard} isLoading={isLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FoiaPricingChart
          orgId={orgId}
          pricing={dashboard?.pricing}
          coverage={dashboard?.pricingCoverage}
          isLoading={isLoading}
        />
        <FoiaScoreComparison scores={dashboard?.scores} isLoading={isLoading} />
      </div>
    </div>
  );
};
