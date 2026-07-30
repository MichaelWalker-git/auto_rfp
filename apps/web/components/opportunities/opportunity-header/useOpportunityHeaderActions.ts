'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDeleteOpportunity, useUpdateOpportunity } from '@/lib/hooks/use-opportunities';
import { TERMINAL_OPPORTUNITY_STATUSES } from '@auto-rfp/core';
import type { OpportunityStatus, OpportunityUpdateRequest, WinData, LossData, LossReasonCategory, Jurisdiction } from '@auto-rfp/core';

interface UseOpportunityHeaderActionsProps {
  oppId: string | null;
  projectId: string | null;
  orgId: string | undefined;
  backUrl: string;
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
          const lossData: LossData = {
            lossReason: values.lossReason ?? 'UNKNOWN',
            lossDate: values.lossDate ? new Date(values.lossDate).toISOString() : new Date().toISOString(),
          };
          if (values.lossReasonDetails?.trim()) lossData.lossReasonDetails = values.lossReasonDetails.trim();
          if (values.winningContractor?.trim()) lossData.winningContractor = values.winningContractor.trim();
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
    [oppId, projectId, updateOpportunity, onSuccess]
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
