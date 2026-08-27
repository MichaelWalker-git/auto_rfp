'use client';

import { ChevronDown } from 'lucide-react';
import type { NotaryStatus } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { notaryBadgeVariant, type NotaryBadgeTone } from '../lib/notary-ui';

interface NotaryBadgeProps {
  status: NotaryStatus | null | undefined;
  /** Whether the evidence panel (rendered BY THE PARENT, below the row) is open. */
  isExpanded: boolean;
  /** Toggle callback — the parent owns the expansion state and the panel. */
  onToggleExpanded: () => void;
  /** id of the parent-rendered detail region this toggle controls (aria-controls). */
  detailId: string;
}

// Amber (REQUIRED) / yellow (POSSIBLY_REQUIRED) tinting — the Shadcn Badge has no
// amber/yellow variant, so we tint `variant="outline"` via className (WCAG 2.1 AA
// contrast; icon + text carry the meaning, never colour alone).
const TONE_CLASS: Record<NotaryBadgeTone, string> = {
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};

/**
 * Per-form notary indicator (FR5.1) with a keyboard-operable expand toggle
 * (FR5.2, NFR7.1). Renders nothing for `NOT_REQUIRED` / null / undefined — the
 * zero-noise default. For a flagged status it shows an icon+text amber/yellow
 * badge and a toggle.
 *
 * CONTROLLED: the expanded evidence panel (`NotaryTriggerList`) is rendered by
 * the parent as a full-width block BELOW the form row — never inline beside the
 * form name, where it would break the header layout. This component renders
 * only the badge + toggle and reports toggle clicks upward.
 *
 * Presentation-only: no fetch, no routing. All data arrives via props.
 */
export const NotaryBadge = ({ status, isExpanded, onToggleExpanded, detailId }: NotaryBadgeProps) => {
  const badge = notaryBadgeVariant(status);
  if (!badge) return null;

  const { variant, label, icon: Icon } = badge;

  return (
    <span className="inline-flex items-center gap-1">
      <Badge
        variant="outline"
        className={cn('gap-1 text-xs', TONE_CLASS[variant])}
        data-testid={`notary-badge-${status}`}
        aria-label={label}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1 text-xs text-muted-foreground"
        data-testid="notary-badge-expand-toggle"
        aria-expanded={isExpanded}
        aria-controls={detailId}
        aria-label={isExpanded ? 'Hide notary detail' : 'Show notary detail'}
        onClick={onToggleExpanded}
      >
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')}
          aria-hidden="true"
        />
        {isExpanded ? 'Hide detail' : 'Detail'}
      </Button>
    </span>
  );
};
