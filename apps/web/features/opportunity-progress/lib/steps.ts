import type { StepId } from './types';

/** Static metadata for each step: its label, the tab it navigates to, and the
 *  one-line "what's this step?" description shown in the details popover. */
export interface StepMeta {
  id: StepId;
  label: string;
  /** Key of the opportunity-page tab this step's completeness drives. Navigation
   *  selects this tab (via the `?tab=` state) instead of anchor-scrolling. */
  tabKey: string;
  description: string;
}

/** Steps in flow order. `tabKey` values match the stable opportunity-page tab
 *  keys (see `OPPORTUNITY_TAB_VALUES` in `components/opportunities`). */
export const STEP_META: readonly StepMeta[] = [
  {
    id: 'solicitations',
    label: 'Solicitations',
    tabKey: 'details',
    description: 'Upload the solicitation documents everything else is built from.',
  },
  {
    id: 'analysis',
    label: 'Analysis',
    tabKey: 'analysis',
    description: 'The AI executive brief, generated across eight sections.',
  },
  {
    id: 'solution-plan',
    label: 'Solution Plan',
    tabKey: 'solution-plan',
    description: 'The source-of-truth plan your response is built from.',
  },
  {
    id: 'required-forms',
    label: 'Required Forms',
    tabKey: 'required-forms',
    description: 'Fill every field on each form the solicitation requires.',
  },
  {
    id: 'rfp-documents',
    label: 'RFP Documents',
    tabKey: 'rfp-documents',
    description: 'Produce the documents the solicitation demands.',
  },
  {
    id: 'ai-review',
    label: 'AI Review',
    tabKey: 'review',
    description: 'Resolve blocking compliance findings before you submit.',
  },
  {
    id: 'submission',
    label: 'Submission',
    tabKey: 'compliance',
    description: 'Check compliance and submit the package.',
  },
] as const;

export const STEP_META_BY_ID: Record<StepId, StepMeta> = STEP_META.reduce(
  (acc, meta) => {
    acc[meta.id] = meta;
    return acc;
  },
  {} as Record<StepId, StepMeta>,
);
