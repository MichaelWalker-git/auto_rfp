/**
 * Related-opportunities count evaluator (ticket 06). Informational only — an
 * "N related" count, never a completeness status. Distinct from the seven
 * completeness steps and from the Outcome status evaluator.
 */
export interface RelatedEvaluation {
  count: number;
  /** Header metric text, e.g. "3 related". */
  label: string;
}

/** Counts the related RFPs. A missing/non-array input counts as zero. */
export const evaluateRelated = (
  items: readonly unknown[] | null | undefined,
): RelatedEvaluation => {
  const count = Array.isArray(items) ? items.length : 0;
  return { count, label: `${count} related` };
};
