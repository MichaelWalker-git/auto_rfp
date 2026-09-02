import { diffWords } from 'diff';

export interface DiffPart {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

/**
 * Word-level diff between two strings. Same primitive VersionDiffView uses, so
 * the before→after proposal card renders consistently with document versions.
 */
export const computeWordDiff = (before: string, after: string): DiffPart[] =>
  diffWords(before, after).map((change) => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
    value: change.value,
  }));
