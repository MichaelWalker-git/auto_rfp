'use client';

import { useMemo } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type {
  ComplianceFinding,
  FindingDecision,
  FindingDecisionState,
} from '@auto-rfp/core';

export interface DecoratedFinding extends ComplianceFinding {
  /** Persisted decision for this finding (by fingerprint), if any. */
  decisionState?: FindingDecisionState;
}

/**
 * Folds persisted decisions into a run's findings and exposes dismiss/resolve.
 *
 * Both `dismissed` and `resolved` are "decided": the finding is tagged and moves
 * out of the active list into its own collapsed group (Dismissed / Resolved),
 * where the only action is Reopen. This keeps a decided finding from re-offering
 * Resolve/Dismiss and from cluttering the active list. Reopen clears the
 * decision, returning the finding to active.
 */
export const useFindingDecisions = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
  findings: ComplianceFinding[],
  decisions: FindingDecision[],
  onChanged: () => void,
) => {
  const byFingerprint = useMemo(
    () => new Map(decisions.map((d) => [d.fingerprint, d])),
    [decisions],
  );

  const decorated: DecoratedFinding[] = useMemo(
    () =>
      findings.map((f) => {
        const decision = byFingerprint.get(f.fingerprint);
        return decision ? { ...f, decisionState: decision.state } : { ...f };
      }),
    [findings, byFingerprint],
  );

  const setDecision = async (fingerprint: string, state: FindingDecisionState | null) => {
    if (!orgId || !projectId || !oppId) return;
    const url = buildApiUrl('compliance-review/decision', { orgId, projectId, opportunityId: oppId });
    await apiMutate(url, 'POST', { fingerprint, state });
    onChanged();
  };

  const activeFindings = decorated.filter((f) => !f.decisionState);
  const dismissedFindings = decorated.filter((f) => f.decisionState === 'dismissed');
  const resolvedFindings = decorated.filter((f) => f.decisionState === 'resolved');

  return { decorated, activeFindings, dismissedFindings, resolvedFindings, setDecision };
};
