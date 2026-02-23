'use client';

import useSWR, { mutate } from 'swr';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { CommentsResponse, CreateCommentDTO } from '@auto-rfp/core';

export function useComments(
  projectId: string,
  orgId: string,
  entityType: string,
  entityId: string,
) {
  const key = buildApiUrl('collaboration/get-comments', {
    projectId,
    orgId,
    entityType,
    entityId,
  });

  const { data, error, isLoading } = useSWR<CommentsResponse>(
    // Only fetch when all required params are present
    projectId && orgId && entityType && entityId ? key : null,
    apiFetcher,
  );

  const createComment = async (dto: CreateCommentDTO) => {
    await apiMutate(buildApiUrl('collaboration/create-comment'), 'POST', dto);
    await mutate(key);
  };

  const resolveComment = async (commentId: string, resolved: boolean) => {
    await apiMutate(
      buildApiUrl(`collaboration/update-comment/${commentId}`, { orgId, projectId, entityType, entityId }),
      'PATCH',
      { commentId, projectId, resolved },
    );
    await mutate(key);
  };

  const deleteComment = async (commentId: string) => {
    await apiMutate(
      buildApiUrl(`collaboration/delete-comment/${commentId}`, { orgId, projectId, entityType, entityId }),
      'DELETE',
    );
    await mutate(key);
  };

  const allComments = data?.items ?? [];
  const unresolvedCount = allComments.filter((c) => !c.resolved).length;

  return {
    comments: allComments,
    unresolvedCount,
    isLoading,
    error,
    createComment,
    resolveComment,
    deleteComment,
  };
}
