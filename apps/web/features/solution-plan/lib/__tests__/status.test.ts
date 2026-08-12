import { canGenerateDocuments, isSolutionPlanRunning } from '../status';
import type { SolutionPlanStatus } from '@auto-rfp/core';

const plan = (status: SolutionPlanStatus) => ({ status });

describe('canGenerateDocuments', () => {
  it('allows generation only when the plan is READY', () => {
    expect(canGenerateDocuments(plan('READY'))).toBe(true);
    expect(canGenerateDocuments(plan('GRILLING'))).toBe(false);
    expect(canGenerateDocuments(plan('GENERATING_SOT'))).toBe(false);
    expect(canGenerateDocuments(plan('FAILED'))).toBe(false);
  });

  it('keeps the gate open for a stale READY plan (ADR-3)', () => {
    expect(canGenerateDocuments({ status: 'READY', isStale: true })).toBe(true);
  });

  it('blocks generation when there is no plan', () => {
    expect(canGenerateDocuments(null)).toBe(false);
    expect(canGenerateDocuments(undefined)).toBe(false);
  });
});

describe('isSolutionPlanRunning', () => {
  it('is true only for in-flight statuses', () => {
    expect(isSolutionPlanRunning(plan('GRILLING'))).toBe(true);
    expect(isSolutionPlanRunning(plan('GENERATING_SOT'))).toBe(true);
    expect(isSolutionPlanRunning(plan('READY'))).toBe(false);
    expect(isSolutionPlanRunning(plan('FAILED'))).toBe(false);
    expect(isSolutionPlanRunning(null)).toBe(false);
  });
});
