'use client';

import useSWRMutation from 'swr/mutation';
import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import {
  ContentLibraryItem,
  ContentLibraryListResponse,
  ContentLibraryTagsResponse,
  CreateContentLibraryItemDTO,
  UpdateContentLibraryItemDTO,
  ApprovalStatus,
} from '@auto-rfp/shared';

// Re-export types for backward compatibility with existing consumers
export type { ContentLibraryItem, ContentLibraryListResponse, ContentLibraryTagsResponse, CreateContentLibraryItemDTO, UpdateContentLibraryItemDTO, ApprovalStatus } from '@auto-rfp/shared';

// Search params type (frontend-only, not in shared)
export interface SearchContentLibraryParams {
  orgId: string;
  kbId: string;
  query?: string;
  category?: string;
  tags?: string[];
  approvalStatus?: ApprovalStatus;
  excludeArchived?: boolean;
  limit?: number;
  offset?: number;
}

// ─── GET Hooks ───

export function useContentLibraryItems(params: SearchContentLibraryParams | null) {
  const queryParams: Record<string, string | number | boolean | undefined> = {};
  if (params) {
    queryParams.orgId = params.orgId;
    queryParams.kbId = params.kbId;
    if (params.query) queryParams.query = params.query;
    if (params.category) queryParams.category = params.category;
    if (params.tags?.length) queryParams.tags = params.tags.join(',');
    if (params.approvalStatus) queryParams.approvalStatus = params.approvalStatus;
    if (params.excludeArchived !== undefined) queryParams.excludeArchived = params.excludeArchived;
    if (params.limit !== undefined) queryParams.limit = params.limit;
    if (params.offset !== undefined) queryParams.offset = params.offset;
  }

  const { data, isLoading, isError, error, mutate } = useApi<ContentLibraryListResponse>(
    params ? ['content-library', params.orgId, params.kbId, params.query, params.category, params.approvalStatus, params.offset] : null,
    params ? buildApiUrl('content-library/get-content-libraries', queryParams) : null,
    { dedupingInterval: 30_000 },
  );

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,
    isLoading,
    isError,
    error,
    mutate,
  };
}

export function useContentLibraryItem(orgId: string | null, itemId: string | null) {
  const { data, isLoading, isError, error, mutate } = useApi<ContentLibraryItem>(
    orgId && itemId ? ['content-library-item', orgId, itemId] : null,
    orgId && itemId ? buildApiUrl(`content-library/get-content-library/${itemId}`, { orgId }) : null,
  );

  return {
    item: data,
    isLoading,
    isError,
    error,
    mutate,
  };
}

export function useContentLibraryCategories(orgId: string | null) {
  const { data, isLoading, isError, error, mutate } = useApi<Array<{ name: string; count: number }>>(
    orgId ? ['content-library-categories', orgId] : null,
    orgId ? buildApiUrl('content-library/categories', { orgId }) : null,
    { dedupingInterval: 60_000 },
  );

  return {
    categories: data || [],
    isLoading,
    isError,
    error,
    mutate,
  };
}

export function useContentLibraryTags(orgId: string | null) {
  const { data, isLoading, isError, error, mutate } = useApi<ContentLibraryTagsResponse>(
    orgId ? ['content-library-tags', orgId] : null,
    orgId ? buildApiUrl('content-library/tags', { orgId }) : null,
    { dedupingInterval: 60_000 },
  );

  return {
    tags: data?.tags ?? [],
    isLoading,
    isError,
    error,
    mutate,
  };
}

// ─── Mutation Hooks ───

export function useCreateContentLibraryItem() {
  const { trigger, isMutating, error } = useSWRMutation<
    ContentLibraryItem,
    ApiError,
    string,
    CreateContentLibraryItemDTO
  >(
    buildApiUrl('content-library/create-content-library'),
    async (url, { arg }) => apiMutate<ContentLibraryItem>(url, 'POST', arg),
  );

  return {
    create: trigger,
    isCreating: isMutating,
    error,
  };
}

export function useUpdateContentLibraryItem(orgId: string, kbId: string, itemId: string) {
  const url = buildApiUrl(`content-library/edit-content-library/${itemId}`, { orgId, kbId });

  const { trigger, isMutating, error } = useSWRMutation<
    ContentLibraryItem,
    ApiError,
    string,
    UpdateContentLibraryItemDTO
  >(url, async (url, { arg }) => apiMutate<ContentLibraryItem>(url, 'PATCH', arg));

  return {
    update: trigger,
    isUpdating: isMutating,
    error,
  };
}

export function useDeleteContentLibraryItem(orgId: string, kbId: string, itemId: string) {
  const deleteItem = async (hardDelete = false) => {
    const url = buildApiUrl(`content-library/delete-content-library/${itemId}`, {
      orgId,
      kbId,
      hardDelete: hardDelete || undefined,
    });
    return apiMutate<{ message: string }>(url, 'DELETE');
  };

  return { deleteItem };
}

export function useApproveContentLibraryItem(orgId: string, kbId: string) {
  const approve = async (itemId: string) => {
    const url = buildApiUrl(`content-library/approve/${itemId}`, { orgId, kbId });
    return apiMutate<{ message: string }>(url, 'POST');
  };

  return { approve };
}

export function useDeprecateContentLibraryItem(orgId: string, kbId: string) {
  const deprecate = async (itemId: string) => {
    const url = buildApiUrl(`content-library/deprecate/${itemId}`, { orgId, kbId });
    return apiMutate<{ message: string }>(url, 'POST');
  };

  return { deprecate };
}

export function useTrackContentLibraryUsage() {
  const trackUsage = async (orgId: string, itemId: string, projectId: string) => {
    const url = buildApiUrl(`content-library/track-usage/${itemId}`, { orgId });
    return apiMutate<unknown>(url, 'POST', { projectId });
  };

  return { trackUsage };
}
