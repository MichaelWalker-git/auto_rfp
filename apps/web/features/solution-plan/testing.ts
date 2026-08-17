import { isSolutionPlanGatedDocumentType } from '@auto-rfp/core';
import type { SolutionPlanGate } from './hooks/useSolutionPlanGate';

/**
 * Test-only factories for `useSolutionPlanGate` return values, shared by the
 * component tests of every generation entry point. Not exported from the
 * feature barrel — import from `@/features/solution-plan/testing`.
 */

/** An open gate (feature on, nothing blocked) with per-field overrides. */
export const gateState = (over: Partial<SolutionPlanGate> = {}): SolutionPlanGate => ({
  isEnabled: true,
  plan: null,
  isGateActive: false,
  isNoBid: false,
  isGrandfathered: false,
  isDocumentTypeBlocked: () => false,
  ...over,
});

/** An active gate blocking exactly the gated types, mirroring the real per-type verdict. */
export const activeGateState = (over: Partial<SolutionPlanGate> = {}): SolutionPlanGate =>
  gateState({
    isGateActive: true,
    isDocumentTypeBlocked: isSolutionPlanGatedDocumentType,
    ...over,
  });

/** A gate held open only by ADR-10 grandfathering — the nudge banner shows. */
export const grandfatheredGateState = (over: Partial<SolutionPlanGate> = {}): SolutionPlanGate =>
  gateState({ isGrandfathered: true, ...over });
