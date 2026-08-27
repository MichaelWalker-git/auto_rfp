import { Stamp } from 'lucide-react';
import type { NotaryCue, NotarySummary } from '@auto-rfp/core';
import { notaryBadgeVariant, notaryChipLabel, cueLabel } from '../notary-ui';

describe('notaryBadgeVariant', () => {
  it('maps REQUIRED to the amber variant with an icon', () => {
    const result = notaryBadgeVariant('REQUIRED');
    expect(result).not.toBeNull();
    expect(result?.variant).toBe('amber');
    expect(result?.label).toBe('Notary required');
    expect(result?.icon).toBe(Stamp);
  });

  it('maps POSSIBLY_REQUIRED to the yellow variant with an icon', () => {
    const result = notaryBadgeVariant('POSSIBLY_REQUIRED');
    expect(result).not.toBeNull();
    expect(result?.variant).toBe('yellow');
    expect(result?.label).toBe('Notary — review needed');
    expect(result?.icon).toBe(Stamp);
  });

  it('returns null for NOT_REQUIRED', () => {
    expect(notaryBadgeVariant('NOT_REQUIRED')).toBeNull();
  });

  it('returns null for null / undefined', () => {
    expect(notaryBadgeVariant(null)).toBeNull();
    expect(notaryBadgeVariant(undefined)).toBeNull();
  });
});

const summary = (overrides: Partial<NotarySummary> = {}): NotarySummary => ({
  anyNotaryRequired: true,
  requiredCount: 0,
  possiblyRequiredCount: 0,
  totalFormsConsidered: 0,
  ...overrides,
});

describe('notaryChipLabel', () => {
  it('returns null when the summary is null or undefined', () => {
    expect(notaryChipLabel(null)).toBeNull();
    expect(notaryChipLabel(undefined)).toBeNull();
  });

  it('returns null when anyNotaryRequired is false', () => {
    expect(
      notaryChipLabel(summary({ anyNotaryRequired: false, requiredCount: 3 })),
    ).toBeNull();
  });

  it('sums required + possibly-required into the count', () => {
    expect(
      notaryChipLabel(summary({ requiredCount: 2, possiblyRequiredCount: 3 })),
    ).toBe('⚖ Notary: 5 forms');
  });

  it('uses the singular for a single flagged form', () => {
    expect(
      notaryChipLabel(summary({ requiredCount: 1, possiblyRequiredCount: 0 })),
    ).toBe('⚖ Notary: 1 form');
  });

  it('drops the count when flagged only at solicitation level (zero flagged forms)', () => {
    // anyNotaryRequired=true with zero per-form counts = an unmapped
    // solicitation-level instruction; "0 forms" would be nonsense.
    expect(
      notaryChipLabel(summary({ requiredCount: 0, possiblyRequiredCount: 0 })),
    ).toBe('⚖ Notary required');
  });
});

describe('cueLabel', () => {
  const cases: Array<[NotaryCue, string]> = [
    ['KEYWORD', 'Keyword match'],
    ['ACK_BLOCK', 'Acknowledgment block'],
    ['STATE_COUNTY', 'State / county line'],
    ['COMMISSION', 'Commission reference'],
    ['SWORN', 'Sworn statement'],
    ['WITNESS', 'Witness line'],
    ['INSTRUCTIONAL', 'Instructional text'],
  ];

  it.each(cases)('maps %s to a human label', (cue, label) => {
    expect(cueLabel(cue)).toBe(label);
  });

  it('falls back to the raw value for an unknown cue', () => {
    expect(cueLabel('SOMETHING_ELSE' as NotaryCue)).toBe('SOMETHING_ELSE');
  });
});
