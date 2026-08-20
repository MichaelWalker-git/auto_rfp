import type { DetectedFormField } from '@auto-rfp/core';

export interface FieldChange {
  fieldId: string;
  label: string;
  /** 'changed' = value differs; 'added' = restore would create it; 'removed' = restore would drop it. */
  kind: 'changed' | 'added' | 'removed';
  /** The current form's value (null/'' when absent). */
  current: string;
  /** The value after restoring the target version. */
  restored: string;
}

const val = (v: string | null | undefined): string => v ?? '';

/**
 * Field-level diff of what RESTORING `versionFields` would do to `currentFields`.
 * Compared by fieldId:
 *   - changed: same field, different value
 *   - removed: in current, not in the version → restore would drop it
 *   - added:   in the version, not in current → restore would re-add it
 * Only fields that would actually change are returned.
 */
export const computeFormFieldDiff = (
  currentFields: DetectedFormField[],
  versionFields: DetectedFormField[],
): FieldChange[] => {
  const currentById = new Map(currentFields.map((f) => [f.fieldId, f]));
  const versionById = new Map(versionFields.map((f) => [f.fieldId, f]));
  const changes: FieldChange[] = [];

  for (const cur of currentFields) {
    const ver = versionById.get(cur.fieldId);
    if (!ver) {
      changes.push({ fieldId: cur.fieldId, label: cur.label, kind: 'removed', current: val(cur.value), restored: '' });
    } else if (val(cur.value) !== val(ver.value)) {
      changes.push({ fieldId: cur.fieldId, label: cur.label, kind: 'changed', current: val(cur.value), restored: val(ver.value) });
    }
  }
  for (const ver of versionFields) {
    if (!currentById.has(ver.fieldId)) {
      changes.push({ fieldId: ver.fieldId, label: ver.label, kind: 'added', current: '', restored: val(ver.value) });
    }
  }

  return changes;
};
