import type { StepId } from './types';

/** Static metadata for each step: its label, the page section it navigates to,
 *  and the one-line "what's this step?" description shown in the details popover. */
export interface StepMeta {
  id: StepId;
  label: string;
  /** Existing DOM section id on the opportunity page (smooth-scroll target). */
  sectionId: string;
  description: string;
}

/** Steps in flow order. Section ids match the `<section id>` anchors already on
 *  the opportunity page (OpportunityView). */
export const STEP_META: readonly StepMeta[] = [
  {
    id: 'solicitations',
    label: 'Solicitations',
    sectionId: 'solicitation-documents',
    description: 'Upload the solicitation documents everything else is built from.',
  },
  {
    id: 'analysis',
    label: 'Analysis',
    sectionId: 'executive-brief',
    description: 'The AI executive brief, generated across eight sections.',
  },
  {
    id: 'solution-plan',
    label: 'Solution Plan',
    sectionId: 'solution-plan',
    description: 'The source-of-truth plan your response is built from.',
  },
  {
    id: 'required-forms',
    label: 'Required Forms',
    sectionId: 'required-forms',
    description: 'Fill every field on each form the solicitation requires.',
  },
  {
    id: 'rfp-documents',
    label: 'RFP Documents',
    sectionId: 'rfp-documents',
    description: 'Produce the documents the solicitation demands.',
  },
  {
    id: 'ai-review',
    label: 'AI Review',
    sectionId: 'ai-compliance-review',
    description: 'Resolve blocking compliance findings before you submit.',
  },
  {
    id: 'submission',
    label: 'Submission',
    sectionId: 'submission-compliance',
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
