import { seedInstructionFromFinding } from '../seedInstructionFromFinding';
import type { ComplianceFinding } from '@auto-rfp/core';

const finding = (over: Partial<ComplianceFinding>): ComplianceFinding => ({
  findingId: 'f1',
  fingerprint: 'fp1',
  targetKind: 'RFP_DOCUMENT',
  issueType: 'POOR_ANSWER',
  severity: 'minor',
  title: 'The phone number is outdated',
  description: 'd',
  anchorValid: true,
  ...over,
});

describe('seedInstructionFromFinding', () => {
  it('produces a consistency instruction for an INCONSISTENCY finding, including the snippet', () => {
    const text = seedInstructionFromFinding(
      finding({ issueType: 'INCONSISTENCY', snippet: '$2.0M', documentTitle: 'Cost Volume' }),
    );
    expect(text).toContain('disagrees across the package');
    expect(text).toContain('"$2.0M"');
    expect(text).toContain('"Cost Volume"');
    expect(text).toContain('consistent everywhere');
  });

  it('falls back to a generic package-wide instruction using the title', () => {
    const text = seedInstructionFromFinding(finding({ title: 'Update the CAGE code' }));
    expect(text).toContain('Update the CAGE code');
    expect(text).toContain('everywhere it appears');
  });

  it('omits the snippet clause when there is no snippet', () => {
    const text = seedInstructionFromFinding(finding({ snippet: undefined }));
    expect(text).not.toContain('Relevant text');
  });
});
