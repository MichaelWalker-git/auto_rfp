/**
 * Tests for the pure decision-application logic in compliance-review.ts.
 * The module imports db/AWS at load time, so those are mocked before import.
 */
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  TransactWriteCommand: jest.fn((p) => ({ type: 'Transact', p })),
  QueryCommand: jest.fn((p) => ({ type: 'Query', p })),
  PutCommand: jest.fn((p) => ({ type: 'Put', p })),
  GetCommand: jest.fn((p) => ({ type: 'Get', p })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { applyDecisionsToFindings } from './compliance-review';
import type { ComplianceFinding, FindingDecision } from '@auto-rfp/core';

const finding = (fingerprint: string): ComplianceFinding => ({
  findingId: `id-${fingerprint}`,
  fingerprint,
  targetKind: 'RFP_DOCUMENT',
  documentId: 'doc-1',
  issueType: 'POOR_ANSWER',
  severity: 'minor',
  title: 't',
  description: 'd',
  anchorValid: false,
});

const decision = (fingerprint: string, state: 'dismissed' | 'resolved'): FindingDecision => ({
  fingerprint,
  state,
  decidedAt: '2026-07-28T00:00:00.000Z',
});

describe('applyDecisionsToFindings', () => {
  it('tags dismissed findings', () => {
    const { findings } = applyDecisionsToFindings([finding('a')], [decision('a', 'dismissed')]);
    expect(findings[0].decisionState).toBe('dismissed');
  });

  it('tags resolved findings (collapsed into the Resolved group, like dismissed)', () => {
    const { findings } = applyDecisionsToFindings([finding('a')], [decision('a', 'resolved')]);
    expect(findings[0].decisionState).toBe('resolved');
  });

  it('leaves undecided findings untouched', () => {
    const { findings } = applyDecisionsToFindings([finding('a')], []);
    expect(findings[0].decisionState).toBeUndefined();
  });

  it('matches decisions by fingerprint only', () => {
    const { findings } = applyDecisionsToFindings(
      [finding('a'), finding('b')],
      [decision('b', 'dismissed')],
    );
    expect(findings.find((f) => f.fingerprint === 'a')?.decisionState).toBeUndefined();
    expect(findings.find((f) => f.fingerprint === 'b')?.decisionState).toBe('dismissed');
  });
});
