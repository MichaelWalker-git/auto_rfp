/**
 * Resilience tests for the model-output schema: a mislabeled enum must degrade
 * to a safe default, not throw away the whole review (regression for the chat
 * 500 where the model put severity value "info" into issueType).
 * The engine imports the Bedrock tool loop at module load, so mock it out.
 */
jest.mock('@/helpers/bedrock-tool-loop', () => ({ invokeClaudeWithTools: jest.fn() }));
jest.mock('@/helpers/compliance-review-tools', () => ({
  COMPLIANCE_REVIEW_TOOLS: [],
  makeComplianceToolExecutor: jest.fn(),
  buildPackageInventory: jest.fn(),
}));
jest.mock('@/helpers/compliance-review-validate', () => ({ validateAndTagFindings: jest.fn() }));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { ReviewOutputSchema } from './compliance-review-engine';

const rawFinding = (over: Record<string, unknown> = {}) => ({
  findingId: 'F-1',
  targetKind: 'RFP_DOCUMENT',
  documentId: 'doc-1',
  issueType: 'INCONSISTENCY',
  severity: 'critical',
  title: 't',
  description: 'd',
  ...over,
});

describe('ReviewOutputSchema resilience', () => {
  it('coerces an invalid issueType ("info") to OTHER instead of throwing', () => {
    const parsed = ReviewOutputSchema.parse({
      answer: 'ok',
      findings: [rawFinding({ issueType: 'info' })],
    });
    expect(parsed.findings[0].issueType).toBe('OTHER');
  });

  it('coerces an invalid severity to info', () => {
    const parsed = ReviewOutputSchema.parse({
      answer: 'ok',
      findings: [rawFinding({ severity: 'blocker' })],
    });
    expect(parsed.findings[0].severity).toBe('info');
  });

  it('coerces an invalid targetKind to RFP_DOCUMENT', () => {
    const parsed = ReviewOutputSchema.parse({
      answer: 'ok',
      findings: [rawFinding({ targetKind: 'SPREADSHEET' })],
    });
    expect(parsed.findings[0].targetKind).toBe('RFP_DOCUMENT');
  });

  it('drops a garbled anchor to undefined rather than failing', () => {
    const parsed = ReviewOutputSchema.parse({
      answer: 'ok',
      findings: [rawFinding({ anchor: { kind: 'paragraph', n: 3 } })],
    });
    expect(parsed.findings[0].anchor).toBeUndefined();
  });

  it('keeps a whole batch when one finding has a bad enum (does not throw)', () => {
    const parsed = ReviewOutputSchema.parse({
      answer: 'ok',
      findings: [rawFinding(), rawFinding({ issueType: 'info' }), rawFinding()],
    });
    expect(parsed.findings).toHaveLength(3);
    expect(parsed.findings[1].issueType).toBe('OTHER');
  });

  it('defaults answer to empty string when missing', () => {
    const parsed = ReviewOutputSchema.parse({ findings: [] });
    expect(parsed.answer).toBe('');
  });
});
