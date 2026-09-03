import { evaluateOutcomeStatus } from '../outcome';
import type { OpportunityStatus } from '@auto-rfp/core';

describe('evaluateOutcomeStatus', () => {
  it.each([
    ['WON', 'Won'],
    ['LOST', 'Lost'],
    ['NO_BID', 'No-bid'],
    ['WITHDRAWN', 'Withdrawn'],
  ] as const)('maps terminal status %s to "%s" and marks it terminal', (status, label) => {
    const result = evaluateOutcomeStatus(status as OpportunityStatus);
    expect(result.label).toBe(label);
    expect(result.isTerminal).toBe(true);
  });

  it.each(['IDENTIFIED', 'QUALIFYING', 'PURSUING', 'SUBMITTED'] as const)(
    'maps non-terminal status %s to "Awaiting outcome"',
    (status) => {
      const result = evaluateOutcomeStatus(status as OpportunityStatus);
      expect(result.label).toBe('Awaiting outcome');
      expect(result.isTerminal).toBe(false);
    },
  );

  it('treats undefined/null as "Awaiting outcome"', () => {
    expect(evaluateOutcomeStatus(undefined).label).toBe('Awaiting outcome');
    expect(evaluateOutcomeStatus(null).label).toBe('Awaiting outcome');
    expect(evaluateOutcomeStatus(undefined).isTerminal).toBe(false);
  });
});
