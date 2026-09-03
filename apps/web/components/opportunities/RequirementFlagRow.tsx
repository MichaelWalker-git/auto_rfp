'use client';

import type { OpportunityItem } from '@auto-rfp/core';
import { isPhysicalSubmission } from '@auto-rfp/core';
import { Globe, Mail, Stamp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notaryChipLabel } from '@/features/required-forms/lib/notary-ui';
import type { OpportunityTabKey } from './opportunity-tabs';

interface RequirementFlagRowProps {
  opportunity: OpportunityItem | null | undefined;
  onSelectTab: (tab: OpportunityTabKey) => void;
  /** Tabs currently shown in the strip — a chip only renders if its owning tab is reachable. */
  visibleTabs: readonly OpportunityTabKey[];
}

/**
 * A single clickable requirement chip. All chips share one size/shape so the row
 * reads as a set (only the colour tells them apart); the label doubles as the
 * accessible name and the click jumps to the tab that owns the full detail.
 */
const RequirementChip = ({
  onClick,
  label,
  text,
  icon: Icon,
  className,
  testId,
}: {
  onClick: () => void;
  label: string;
  text: string;
  icon: LucideIcon;
  className: string;
  testId: string;
}) => (
  <Button
    type="button"
    variant="ghost"
    onClick={onClick}
    aria-label={label}
    className="h-auto rounded-full p-0 hover:bg-transparent"
  >
    <Badge
      variant="outline"
      className={cn('h-6 gap-1 rounded-full px-2.5 text-xs font-medium', className)}
      data-testid={testId}
    >
      <Icon className="h-3.5 w-3.5" />
      {text}
    </Badge>
  </Button>
);

/**
 * Requirement flag-row (ADR 0001) — the can't-miss constraint chips pinned in the
 * persistent header on every tab. Each chip auto-hides when it does not apply, and
 * clicking one selects the tab that owns the full detail:
 *   US-based team → Details, Physical submission → Compliance details, Notary → Required forms.
 * Renders nothing when no constraint applies, so the header stays clean.
 */
export const RequirementFlagRow = ({
  opportunity,
  onSelectTab,
  visibleTabs,
}: RequirementFlagRowProps) => {
  // A chip only shows when its owning tab is reachable — otherwise clicking it
  // would fall back to Details and appear to do nothing (e.g. a notary flag with
  // no detected required forms, so the Required forms tab is hidden).
  const showUsTeam =
    opportunity?.deliveryLocationConstraint === 'US_ONLY' && visibleTabs.includes('details');
  const showPhysical =
    isPhysicalSubmission(opportunity?.submissionMethod) && visibleTabs.includes('compliance');
  const notaryLabel = opportunity?.notarySummary
    ? notaryChipLabel(opportunity.notarySummary)
    : null;
  const showNotary = !!notaryLabel && visibleTabs.includes('required-forms');

  if (!showUsTeam && !showPhysical && !showNotary) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="requirement-flag-row">
      {showUsTeam && (
        <RequirementChip
          onClick={() => onSelectTab('details')}
          label="US-based team required"
          text="US-based team required"
          icon={Globe}
          className="bg-amber-50 text-amber-700 border-amber-200"
          testId="us-team-chip"
        />
      )}

      {showPhysical && (
        <RequirementChip
          onClick={() => onSelectTab('compliance')}
          label="Physical submission required"
          text="Physical Mail"
          icon={Mail}
          className="bg-blue-50 text-blue-800 border-blue-200"
          testId="physical-submission-chip"
        />
      )}

      {showNotary && (
        <RequirementChip
          onClick={() => onSelectTab('required-forms')}
          label="Notary required"
          // Strip the label's leading ⚖ glyph — the Stamp icon carries the meaning
          // and keeps this chip visually uniform with its siblings.
          text={notaryLabel.replace(/^⚖\s*/, '')}
          icon={Stamp}
          className="bg-amber-50 text-amber-700 border-amber-200"
          testId="opportunity-notary-chip"
        />
      )}
    </div>
  );
};
