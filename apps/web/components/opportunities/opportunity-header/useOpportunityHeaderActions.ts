'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDeleteOpportunity, useUpdateOpportunity } from '@/lib/hooks/use-opportunities';
import type { z } from 'zod';

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
      try {
        await updateOpportunity({
          projectId,
          oppId,
          patch: {
            title: values.title,
            description: values.description?.trim() || null,
            type: values.type?.trim() || null,
            setAside: values.setAside?.trim() || null,
            naicsCode: values.naicsCode?.trim() || null,
            pscCode: values.pscCode?.trim() || null,
            organizationName: values.organizationName?.trim() || null,
          },
        });
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
