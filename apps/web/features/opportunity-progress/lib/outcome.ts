import type { OpportunityStatus } from '@auto-rfp/core';

/**
 * Outcome status evaluator (ticket 05). Distinct from the seven completeness
 * steps: it produces a disposition *label*, never an "X of Y" metric. Terminal
 * statuses map to their label; everything else is "Awaiting outcome".
 */
export const OUTCOME_STATUS_LABELS = [
  'Awaiting outcome',
  'Won',
  'Lost',
  'No-bid',
  'Withdrawn',
] as const;
export type OutcomeStatusLabel = (typeof OUTCOME_STATUS_LABELS)[number];

/** Terminal opportunity statuses → their outcome label. Anything not here is
 *  treated as still awaiting a decision. */
const TERMINAL_LABELS: Partial<Record<OpportunityStatus, OutcomeStatusLabel>> = {
  WON: 'Won',
  LOST: 'Lost',
  NO_BID: 'No-bid',
  WITHDRAWN: 'Withdrawn',
};

export interface OutcomeEvaluation {
  label: OutcomeStatusLabel;
  /** True once the opportunity has reached a terminal disposition. */
  isTerminal: boolean;
}

/** Reads `opportunity.status`; terminal states map to their label, everything
 *  else (including undefined/unknown) to "Awaiting outcome". */
export const evaluateOutcomeStatus = (
  status: OpportunityStatus | null | undefined,
): OutcomeEvaluation => {
  const terminal = status ? TERMINAL_LABELS[status] : undefined;
  return terminal
    ? { label: terminal, isTerminal: true }
    : { label: 'Awaiting outcome', isTerminal: false };
};
