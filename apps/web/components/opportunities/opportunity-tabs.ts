/**
 * Stable tab keys for the opportunity detail page (ADR 0001). The order here is
 * the order tabs appear in the strip. Keys are also referenced by the progress
 * engine (`STEP_META[].tabKey`) so a step navigates to its owning tab.
 *
 * Progress steps are NOT 1:1 with tabs: Details reuses the `solicitations` step
 * metric, while Outcome and Related are driven by their own evaluators.
 */
export const OPPORTUNITY_TAB_VALUES = [
  'details',
  'analysis',
  'solution-plan',
  'required-forms',
  'rfp-documents',
  'review',
  'compliance',
  'outcome',
  'related',
] as const;

export type OpportunityTabKey = (typeof OPPORTUNITY_TAB_VALUES)[number];

export const DEFAULT_OPPORTUNITY_TAB: OpportunityTabKey = 'details';

/** Human-readable tab labels shown in the strip. */
export const OPPORTUNITY_TAB_LABELS: Record<OpportunityTabKey, string> = {
  details: 'Details',
  analysis: 'Analysis',
  'solution-plan': 'Solution plan',
  'required-forms': 'Forms',
  'rfp-documents': 'RFP docs',
  review: 'Review',
  compliance: 'Compliance',
  outcome: 'Outcome',
  related: 'Related opportunities',
};

/** Tabs that always render regardless of org flags / opportunity data. The rest
 *  (solution-plan, required-forms, review, related) are conditionally shown. */
export const ALWAYS_VISIBLE_TABS: readonly OpportunityTabKey[] = [
  'details',
  'analysis',
  'rfp-documents',
  'compliance',
  'outcome',
];
