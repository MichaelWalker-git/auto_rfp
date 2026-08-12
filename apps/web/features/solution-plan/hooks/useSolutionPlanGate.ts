'use client';

import { useCallback } from 'react';
import { isSolutionPlanGatedDocumentType, type SolutionPlanItem } from '@auto-rfp/core';
import { useCurrentOrganization } from '@/context/organization-context';
import { useRFPDocuments } from '@/lib/hooks/use-rfp-documents';
import { useSolutionPlan } from './useSolutionPlan';
import { canGenerateDocuments } from '../lib/status';
import { hasGrandfatheredDocument } from '../lib/gating';

export interface SolutionPlanGate {
  /** Whether the org has the Solution Plan feature enabled at all. */
  isEnabled: boolean;
  /** The opportunity's plan, when one exists. */
  plan: SolutionPlanItem | null;
  /**
   * True when generation of gated document types must be blocked: feature
   * enabled, no READY plan, and the opportunity is not grandfathered.
   * Stays false while the plan/documents are still loading — the UI never
   * blocks on incomplete data; the server 409 is the backstop.
   */
  isGateActive: boolean;
  /** Per-type verdict: gate active AND the type is not exempt. */
  isDocumentTypeBlocked: (documentType: string) => boolean;
}

/**
 * Client-side mirror of the server generation gate (T9/T12): document
 * generation for gated types requires a READY Solution Plan (stale is still
 * READY, ADR-3), unless the org flag is off or the opportunity is
 * grandfathered by an already-generated gated document (ADR-10).
 */
export const useSolutionPlanGate = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
): SolutionPlanGate => {
  const { currentOrganization } = useCurrentOrganization();
  const isEnabled = !!currentOrganization?.enableSolutionPlan;

  // The server resolves a missing opportunityId to 'default' — match it so the
  // plan lookup and grandfather check inspect the same records the gate does.
  const effectiveOpportunityId = opportunityId || 'default';

  const { plan, isLoading: isPlanLoading } = useSolutionPlan(
    isEnabled ? orgId : undefined,
    isEnabled ? projectId : undefined,
    isEnabled ? effectiveOpportunityId : undefined,
  );

  // Only look at existing documents when the plan alone wouldn't open the gate.
  const needsGrandfatherCheck = isEnabled && !isPlanLoading && !canGenerateDocuments(plan);
  const { documents, isLoading: isDocumentsLoading } = useRFPDocuments(
    needsGrandfatherCheck ? (projectId ?? null) : null,
    needsGrandfatherCheck ? (orgId ?? null) : null,
    effectiveOpportunityId,
  );

  const isGateActive =
    needsGrandfatherCheck && !isDocumentsLoading && !hasGrandfatheredDocument(documents);

  const isDocumentTypeBlocked = useCallback(
    (documentType: string) => isGateActive && isSolutionPlanGatedDocumentType(documentType),
    [isGateActive],
  );

  return { isEnabled, plan, isGateActive, isDocumentTypeBlocked };
};
