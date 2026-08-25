'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDeleteOpportunity, useUpdateOpportunity } from '@/lib/hooks/use-opportunities';
import { TERMINAL_OPPORTUNITY_STATUSES } from '@auto-rfp/core';
import type { OpportunityStatus, OpportunityUpdateRequest, WinData, LossData, LossReasonCategory, Jurisdiction, DeliveryLocationConstraint } from '@auto-rfp/core';

interface UseOpportunityHeaderActionsProps {
  oppId: string | null;
  projectId: string | null;
  orgId: string | undefined;
  backUrl: string;
  /** The opportunity's currently-stored delivery constraint, used to detect a real user change. */
  currentDeliveryConstraint?: DeliveryLocationConstraint | null;
  /**
   * The opportunity's currently-stored loss detail.
   *
   * Required so a header edit can PRESERVE the LossData fields this form does not
   * collect — `ourBidAmount`, `winningBidAmount`, `evaluationScores`, which the outcome
   * dialog records and the FOIA comparison dashboard reads. `lossData` is one whole
   * DynamoDB attribute, so rebuilding it from four form fields replaces the stored
   * object and silently drops the rest.
   */
  currentLossData?: LossData | null;
  onSuccess?: () => void;
}

export interface EditFormValues {
  title: string;
  description?: string;
  organizationName?: string;
  type?: string;
  setAside?: string;
  naicsCode?: string;
  pscCode?: string;
  contactName?: string;
  contactEmail?: string;
  decisionDateIso?: string;
  contractStartDateIso?: string;
  deliveryLocationConstraint?: DeliveryLocationConstraint;
  // ── Status + outcome ──────────────────────────────────────────────────────
  status?: OpportunityStatus;
  outcomeComment?: string;
  jurisdiction?: Jurisdiction | '';
  state?: string;
  // Win detail (status === 'WON')
  contractValue?: string;
  contractNumber?: string;
  awardDate?: string;
  keyFactors?: string;
  // Loss detail (status === 'LOST')
  lossReason?: LossReasonCategory;
  lossReasonDetails?: string;
  winningContractor?: string;
  lossDate?: string;
}

export const useOpportunityHeaderActions = ({
  oppId,
  projectId,
  orgId,
  backUrl,
  currentDeliveryConstraint,
  currentLossData,
  onSuccess,
}: UseOpportunityHeaderActionsProps) => {
  const router = useRouter();
  const { trigger: deleteOpportunity, isMutating: isDeleting } = useDeleteOpportunity();
  const { trigger: updateOpportunity, isMutating: isUpdating } = useUpdateOpportunity(orgId);

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleUpdate = useCallback(
    async (values: EditFormValues) => {
      if (!oppId || !projectId) return;

      setSubmitError(null);

      const patch: OpportunityUpdateRequest = {
        title: values.title,
        description: values.description?.trim() || null,
        type: values.type?.trim() || null,
        setAside: values.setAside?.trim() || null,
        naicsCode: values.naicsCode?.trim() || null,
        pscCode: values.pscCode?.trim() || null,
        organizationName: values.organizationName?.trim() || null,
        contactName: values.contactName?.trim() || null,
        contactEmail: values.contactEmail?.trim() || null,
        decisionDateIso: values.decisionDateIso?.trim() || null,
        contractStartDateIso: values.contractStartDateIso?.trim() || null,
      };

      // Delivery-location constraint — only mark USER_SET when the user actually CHANGED it.
      // Writing it on every save (the form always sends a value, and 'UNKNOWN' is truthy) would
      // lock deliveryConstraintSource to USER_SET and permanently disable AI auto-detection.
      const storedConstraint = currentDeliveryConstraint ?? 'UNKNOWN';
      if (values.deliveryLocationConstraint && values.deliveryLocationConstraint !== storedConstraint) {
        patch.deliveryLocationConstraint = values.deliveryLocationConstraint;
        patch.deliveryConstraintSource = 'USER_SET';
      }

      // Status + outcome detail
      if (values.status) {
        patch.status = values.status;
        patch.outcomeComment = values.outcomeComment?.trim() || null;

        const isTerminal = TERMINAL_OPPORTUNITY_STATUSES.includes(values.status);
        if (isTerminal) {
          patch.jurisdiction = values.jurisdiction || undefined;
          patch.state = values.jurisdiction === 'STATE' ? (values.state || null) : null;
        }

        if (values.status === 'WON') {
          const winData: WinData = {
            contractValue: values.contractValue ? parseFloat(values.contractValue) : 0,
            awardDate: values.awardDate ? new Date(values.awardDate).toISOString() : new Date().toISOString(),
          };
          if (values.contractNumber?.trim()) winData.contractNumber = values.contractNumber.trim();
          if (values.keyFactors?.trim()) winData.keyFactors = values.keyFactors.trim();
          patch.winData = winData;
        } else if (values.status === 'LOST') {
          /**
           * Spread the STORED lossData first, then overwrite only the four fields this
           * form owns.
           *
           * `lossData` is written to DynamoDB as one whole attribute, so a patch that
           * rebuilds it from scratch REPLACES the stored object rather than merging into
           * it. This form collects lossReason, lossDate, lossReasonDetails and
           * winningContractor — but the outcome dialog also records `ourBidAmount`,
           * `winningBidAmount` and `evaluationScores`, which feed the FOIA comparison
           * dashboard. Rebuilding from scratch here silently deleted all three.
           *
           * The deletion failed in the dangerous direction: the row stays LOST, so it
           * still counts in the dashboard's `pricingCoverage.total` while dropping out of
           * `withPricing` — the chart quietly loses a bar and the coverage line reports
           * the gap as missing data entry rather than as data we destroyed. No error, no
           * audit signal.
           *
           * Any field a future form adds to LossData is preserved by this spread without
           * needing to touch this hook again.
           */
          const lossData: LossData = {
            ...(currentLossData ?? {}),
            lossReason: values.lossReason ?? 'UNKNOWN',
            lossDate: values.lossDate ? new Date(values.lossDate).toISOString() : new Date().toISOString(),
          };

          // Empty input clears the field rather than leaving the stored value, so a user
          // can genuinely blank out a detail they entered by mistake.
          const details = values.lossReasonDetails?.trim();
          if (details) lossData.lossReasonDetails = details;
          else delete lossData.lossReasonDetails;

          const contractor = values.winningContractor?.trim();
          if (contractor) lossData.winningContractor = contractor;
          else delete lossData.winningContractor;

          patch.lossData = lossData;
        }
      }

      if (!oppId || !projectId) return;

      try {
        await updateOpportunity({ projectId, oppId, patch });
        setIsEditing(false);
        onSuccess?.();
      } catch (err: unknown) {
        setSubmitError((err as Error)?.message || 'Failed to update opportunity');
      }
    },
    // currentLossData and currentDeliveryConstraint are read inside, so they belong
    // here: a stale closure would spread yesterday's lossData over today's edit.
    [oppId, projectId, updateOpportunity, onSuccess, currentDeliveryConstraint, currentLossData]
  );

  const handleDelete = useCallback(async () => {
    if (!oppId || !projectId || !orgId) return;

    setDeleteError(null);
    try {
      await deleteOpportunity({ projectId, oppId, orgId });
      setShowDeleteConfirm(false);
      router.push(backUrl);
    } catch (err: unknown) {
      setDeleteError((err as Error)?.message || 'Failed to delete opportunity');
    }
  }, [oppId, projectId, orgId, deleteOpportunity, router, backUrl]);

  return {
    // Edit state
    isEditing,
    setIsEditing,
    isUpdating,
    submitError,
    setSubmitError,
    handleUpdate,

    // Delete state
    showDeleteConfirm,
    setShowDeleteConfirm,
    isDeleting,
    deleteError,
    setDeleteError,
    handleDelete,
  };
};
