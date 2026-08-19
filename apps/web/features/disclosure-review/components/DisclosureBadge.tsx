'use client';

import { Badge } from '@/components/ui/badge';
import type { DisclosureLevel } from '@auto-rfp/core';

const LABELS: Record<DisclosureLevel, { text: string; variant: 'secondary' | 'destructive' | 'outline' }> = {
  NAMEABLE: { text: 'Nameable', variant: 'outline' },
  ANONYMIZED_ONLY: { text: 'Anonymize', variant: 'secondary' },
  PERMISSION_REQUIRED: { text: 'Permission required', variant: 'secondary' },
  DO_NOT_USE: { text: 'Do not use', variant: 'destructive' },
};

/** Human-readable label per disclosure level, for badges and selects. */
export const DISCLOSURE_LABELS: Record<DisclosureLevel, string> = {
  NAMEABLE: LABELS.NAMEABLE.text,
  ANONYMIZED_ONLY: LABELS.ANONYMIZED_ONLY.text,
  PERMISSION_REQUIRED: LABELS.PERMISSION_REQUIRED.text,
  DO_NOT_USE: LABELS.DO_NOT_USE.text,
};

interface DisclosureBadgeProps {
  level: DisclosureLevel;
  /**
   * When true (default), render a subtle badge for NAMEABLE so a reviewed row is
   * visibly distinct from an unreviewed one. Set false on generation-context
   * surfaces where only a *warning* matters and NAMEABLE needs no marker.
   */
  showNameable?: boolean;
}

/**
 * Visible disclosure indicator shown wherever a match/project appears.
 * NAMEABLE renders a muted marker (unless `showNameable={false}`), everything
 * else renders a warning badge scaled by severity.
 */
export const DisclosureBadge = ({ level, showNameable = true }: DisclosureBadgeProps) => {
  if (level === 'NAMEABLE' && !showNameable) return null;
  const { text, variant } = LABELS[level];
  const className = level === 'NAMEABLE' ? 'text-muted-foreground' : undefined;
  return (
    <Badge variant={variant} className={className}>
      {text}
    </Badge>
  );
};
