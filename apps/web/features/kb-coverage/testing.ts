import { getRequiredCoverageCategories, getKBCoverageCategoryLabel } from '@auto-rfp/core';
import type { KBCoverage } from './hooks/useKBCoverage';

/**
 * Test-only factories for `useKBCoverage` return values, shared by the component
 * tests of every generation entry point. Mirrors
 * `@/features/solution-plan/testing` — not exported from the feature barrel;
 * import from `@/features/kb-coverage/testing`.
 */

/** Full coverage, verdict in hand, gate off: nothing to warn about, nothing blocked. */
export const coverageState = (over: Partial<KBCoverage> = {}): KBCoverage => ({
  snapshot: {},
  isGateEnabled: false,
  isLoading: false,
  error: undefined,
  hasVerdict: true,
  hasRequirements: (documentType) => getRequiredCoverageCategories(documentType).length > 0,
  getStatus: () => ({ covered: true, missing: [] }),
  getMissing: () => [],
  isDocumentTypeBlocked: () => false,
  ...over,
});

/**
 * A real gap on every type that has KB requirements, named the way the server
 * names it. `isGateEnabled` decides warn vs. block, so callers pick the tone.
 */
export const gapCoverageState = (over: Partial<KBCoverage> = {}): KBCoverage => {
  const missingFor = (documentType: string) =>
    getRequiredCoverageCategories(documentType).map((key) => ({
      key,
      label: getKBCoverageCategoryLabel(key),
    }));

  return coverageState({
    getStatus: (documentType) => {
      const missing = missingFor(documentType);
      return { covered: missing.length === 0, missing };
    },
    getMissing: missingFor,
    isDocumentTypeBlocked: () => false,
    ...over,
  });
};

/** A gap with the org's gate armed: the rows are unselectable, matching the server 409. */
export const blockingCoverageState = (over: Partial<KBCoverage> = {}): KBCoverage =>
  gapCoverageState({
    isGateEnabled: true,
    isDocumentTypeBlocked: (documentType) =>
      getRequiredCoverageCategories(documentType).length > 0,
    ...over,
  });

/** The probe hasn't answered yet — no verdict, so no badge may claim readiness. */
export const loadingCoverageState = (over: Partial<KBCoverage> = {}): KBCoverage =>
  coverageState({ isLoading: true, hasVerdict: false, ...over });
