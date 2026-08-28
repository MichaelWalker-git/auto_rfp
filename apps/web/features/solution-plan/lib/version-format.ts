import type { SolutionPlanVersionOrigin } from '@auto-rfp/core';

/**
 * Human-readable rendering of the closed origin enum (contract C1/C3 —
 * `generation | manual-save | restore`; adding a value upstream is a breaking
 * change for this map, per the contract's evolution rules).
 */
export const VERSION_ORIGIN_LABELS: Record<SolutionPlanVersionOrigin, string> = {
  generation: 'Generation',
  'manual-save': 'Manual save',
  restore: 'Restore',
};

export const formatVersionOrigin = (origin: SolutionPlanVersionOrigin): string =>
  VERSION_ORIGIN_LABELS[origin];

/** Date + time shown on history rows and version banners (W2/W3). */
export const formatVersionTimestamp = (createdAt: string): string =>
  new Date(createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Date-only rendering for the compact dropdown trigger/entries (W1). */
export const formatVersionDate = (createdAt: string): string =>
  new Date(createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
