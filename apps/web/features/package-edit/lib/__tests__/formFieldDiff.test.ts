import { computeFormFieldDiff } from '../formFieldDiff';
import type { DetectedFormField } from '@auto-rfp/core';

const field = (fieldId: string, value: string | null, label = fieldId): DetectedFormField =>
  ({
    fieldId,
    label,
    value,
    status: 'AUTO_FILLED',
    confidence: null,
    profileFieldKey: null,
    manualReason: null,
    pageNumber: null,
    cellReference: null,
    sheetName: null,
    sheetIndex: null,
    boundingBox: null,
    markType: 'TEXT',
    markChar: null,
    markGeometry: null,
    matrixCategory: null,
    matrixFeature: null,
    matrixColumn: 'OTHER',
    docxAnchor: null,
  }) as DetectedFormField;

describe('computeFormFieldDiff', () => {
  it('flags a changed value', () => {
    const changes = computeFormFieldDiff([field('a', '$2.0M')], [field('a', '$2.4M')]);
    expect(changes).toEqual([
      { fieldId: 'a', label: 'a', kind: 'changed', current: '$2.0M', restored: '$2.4M' },
    ]);
  });

  it('flags a field the restore would remove (present now, absent in version)', () => {
    const changes = computeFormFieldDiff([field('a', 'x')], []);
    expect(changes[0]).toMatchObject({ fieldId: 'a', kind: 'removed', current: 'x', restored: '' });
  });

  it('flags a field the restore would add back (absent now, present in version)', () => {
    const changes = computeFormFieldDiff([], [field('a', 'x')]);
    expect(changes[0]).toMatchObject({ fieldId: 'a', kind: 'added', current: '', restored: 'x' });
  });

  it('returns nothing when values are identical', () => {
    expect(computeFormFieldDiff([field('a', 'same')], [field('a', 'same')])).toEqual([]);
  });

  it('treats null and empty string as equal (no spurious change)', () => {
    expect(computeFormFieldDiff([field('a', null)], [field('a', '')])).toEqual([]);
  });
});
