import { canGenerateDocuments, isNoBidPlan, isSolutionPlanRunning } from '../status';
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
    const stalePlan = { status: 'READY' as const, isStale: true };
    expect(canGenerateDocuments(stalePlan)).toBe(true);
  });

  it('blocks generation when there is no plan', () => {
    expect(canGenerateDocuments(null)).toBe(false);
    expect(canGenerateDocuments(undefined)).toBe(false);
  });

  it('blocks generation for a READY plan with a NO_BID decision', () => {
    expect(canGenerateDocuments({ status: 'READY', bidDecision: 'NO_BID' })).toBe(false);
  });

  it('keeps the gate open for READY plans with BID or no decision (legacy)', () => {
    expect(canGenerateDocuments({ status: 'READY', bidDecision: 'BID' })).toBe(true);
    expect(canGenerateDocuments({ status: 'READY' })).toBe(true);
  });
});

describe('isNoBidPlan', () => {
  it('is true only for READY plans with a NO_BID decision', () => {
    expect(isNoBidPlan({ status: 'READY', bidDecision: 'NO_BID' })).toBe(true);
    expect(isNoBidPlan({ status: 'READY', bidDecision: 'BID' })).toBe(false);
    expect(isNoBidPlan({ status: 'READY' })).toBe(false);
    expect(isNoBidPlan({ status: 'GRILLING', bidDecision: 'NO_BID' })).toBe(false);
    expect(isNoBidPlan(null)).toBe(false);
    expect(isNoBidPlan(undefined)).toBe(false);
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
