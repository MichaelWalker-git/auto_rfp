'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import {
  getRequiredCoverageCategories,
  type KBCoverageDocumentTypeStatus,
  type KBCoverageMissingCategory,
  type KBCoverageResponse,
  type KBCoverageSnapshot,
} from '@auto-rfp/core';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';

/** A document type with no KB requirements is trivially covered. */
const COVERED: KBCoverageDocumentTypeStatus = { covered: true, missing: [] };

export interface KBCoverage {
  /** What the org's KB holds, per category. Empty until loaded. */
  snapshot: KBCoverageSnapshot;
  /** True when a gap blocks generation for this org; false means warn only. */
  isGateEnabled: boolean;
  isLoading: boolean;
  error?: ApiError;
  /**
   * Whether the server actually answered. False while the probe is in flight,
   * false when it failed, and false with no `orgId` to ask about. Consumers
   * MUST check this before reporting coverage: `getMissing` returns `[]` for
   * "nothing is missing" *and* for "we don't know yet", and rendering the
   * second as a reassuring "KB ready" badge is a lie the operator can't see
   * through.
   */
  hasVerdict: boolean;
  /** True for a type that has requirements at all — unmapped types get no badge. */
  hasRequirements: (documentType: string) => boolean;
  /** Coverage verdict for one document type. */
  getStatus: (documentType: string) => KBCoverageDocumentTypeStatus;
  /** Named gaps for one document type, for the badge and the toast. */
  getMissing: (documentType: string) => KBCoverageMissingCategory[];
  /**
   * True only when a real gap must block this type: gate armed, coverage
   * loaded, and something is missing.
   */
  isDocumentTypeBlocked: (documentType: string) => boolean;
}

/**
 * Client-side mirror of the server KB coverage gate. One request answers every
 * document type, because both probes are org-scoped.
 *
 * Never blocks while loading — the same discipline as `useSolutionPlanGate`:
 * an in-flight probe must not disable checkboxes, and the server 409 is the
 * backstop if the client is wrong.
 */
export const useKBCoverage = (orgId: string | undefined): KBCoverage => {
  const url = orgId ? buildApiUrl('rfp-document/kb-coverage', { orgId }) : null;

  const { data, error, isLoading } = useSWR<KBCoverageResponse, ApiError>(url, apiFetcher, {
    revalidateOnFocus: false,
  });

  const byDocumentType = data?.byDocumentType;

  const hasRequirements = useCallback(
    (documentType: string) => getRequiredCoverageCategories(documentType).length > 0,
    [],
  );

  // An unmapped type, or a type whose verdict hasn't arrived, reads as covered
  // so the UI never invents a gap it hasn't confirmed.
  const getStatus = useCallback(
    (documentType: string) => byDocumentType?.[documentType] ?? COVERED,
    [byDocumentType],
  );

  const getMissing = useCallback(
    (documentType: string) => getStatus(documentType).missing,
    [getStatus],
  );

  const isGateEnabled = data?.isGateEnabled ?? false;

  const isDocumentTypeBlocked = useCallback(
    (documentType: string) => isGateEnabled && !getStatus(documentType).covered,
    [isGateEnabled, getStatus],
  );

  return {
    snapshot: data?.snapshot ?? {},
    isGateEnabled,
    isLoading,
    error,
    hasVerdict: Boolean(data),
    hasRequirements,
    getStatus,
    getMissing,
    isDocumentTypeBlocked,
  };
};
