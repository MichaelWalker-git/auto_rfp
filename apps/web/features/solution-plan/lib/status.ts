import type { SolutionPlanStatus } from '@auto-rfp/core';

/** The minimal plan shape the status predicates need. */
type PlanLike = { status: SolutionPlanStatus } | null | undefined;

/**
 * Whether a grilling run is currently in flight (interview or synthesis).
 * Drives the 3s polling intervals and the live-transcript view.
 */
export const isSolutionPlanRunning = (plan: PlanLike): boolean =>
  plan?.status === 'GRILLING' || plan?.status === 'GENERATING_SOT';

/**
 * Whether document generation is allowed for this opportunity (ADR-3):
 * the plan must be READY — `isStale` does NOT close the gate, a stale plan
 * only shows the warning banner.
 */
export const canGenerateDocuments = (plan: PlanLike): boolean => plan?.status === 'READY';
