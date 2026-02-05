import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

// Types for Content Library
export interface ContentSource {
  id: string;
  fileName?: string;
  pageNumber?: string | number;
  documentId?: string;
  chunkKey?: string;
  relevance?: number;
  textContent?: string;
}

export interface ContentLibraryVersion {
  version: number;
  text: string;
  createdAt: string;
  createdBy: string;
  changeNotes?: string;
}

export type ApprovalStatus = 'DRAFT' | 'APPROVED' | 'DEPRECATED';

export interface ContentLibraryItem {
  id: string;
  orgId: string;
  kbId: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  description?: string;
  sources?: ContentSource[];
  usageCount: number;
  lastUsedAt?: string | null;
  usedInProjectIds: string[];
  currentVersion: number;
  versions: ContentLibraryVersion[];
  isArchived: boolean;
  archivedAt?: string | null;
  confidenceScore?: number;
  approvalStatus: ApprovalStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

export interface ContentLibraryListResponse {
  items: ContentLibraryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ContentLibraryTagsResponse {
  tags: Array<{ name: string; count: number }>;
}

export interface CreateContentLibraryItemDTO {
  orgId: string;
  kbId: string;
  question: string;
  answer: string;
  category: string;
  tags?: string[];
  description?: string;
  sources?: ContentSource[];
  confidenceScore?: number;
}

export interface UpdateContentLibraryItemDTO {
  question?: string;
  answer?: string;
  category?: string;
  tags?: string[];
  description?: string;
  sources?: ContentSource[];
  confidenceScore?: number;
  changeNotes?: string;
}

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

// API base URL
const API_BASE = `${env.BASE_API_URL}/content-library`;

/**
 * SWR fetcher that uses authFetcher for authenticated requests
 */
async function fetcher(url: string) {
  const res = await authFetcher(url, { method: 'GET' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch');
  }
  const json = await res.json();
  // The API returns the data directly, not wrapped in a 'data' property
  return json;
}

/**
 * SWR mutation fetcher that uses authFetcher for authenticated requests
 */
async function mutationFetcher(
  url: string,
  { arg }: { arg: { method: string; body?: unknown } }
) {
  const res = await authFetcher(url, {
    method: arg.method,
    body: JSON.stringify(arg.body),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch');
  }
  const json = await res.json();
  // The API returns the data directly, not wrapped in a 'data' property
  return json;
}

/**
 * Hook to list/search content library items
 */
export function useContentLibraryItems(params: SearchContentLibraryParams | null) {
  const entries: Array<[string, string]> = [];
  if (params) {
    entries.push(['orgId', params.orgId]);
    if (params.query) entries.push(['query', params.query]);
    if (params.category) entries.push(['category', params.category]);
    if (params.tags?.length) entries.push(['tags', params.tags.join(',')]);
    if (params.approvalStatus) entries.push(['approvalStatus', params.approvalStatus]);
    if (params.excludeArchived !== undefined) entries.push(['excludeArchived', String(params.excludeArchived)]);
    if (params.limit !== undefined) entries.push(['limit', String(params.limit)]);
    if (params.offset !== undefined) entries.push(['offset', String(params.offset)]);
    if (params.kbId !== undefined) entries.push(['kbId', String(params.kbId)])
  }
  const queryParams = params ? new URLSearchParams(entries).toString() : null;

  const { data, error, isLoading, mutate } = useSWR<ContentLibraryListResponse>(
    params ? `${API_BASE}/get-content-libraries?${queryParams}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  // Log the response for debugging
  if (data) {
    console.log('Content library items response:', data);
  }

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook to get a single content library item
 */
export function useContentLibraryItem(orgId: string | null, itemId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ContentLibraryItem>(
    orgId && itemId
      ? `${API_BASE}/get-content-library/${itemId}?orgId=${orgId}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    item: data,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook to get content library categories
 */
export function useContentLibraryCategories(orgId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ name: string; count: number }[]>(
    orgId ? `${API_BASE}/categories?orgId=${orgId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    categories: data || [],
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook to get content library tags
 */
export function useContentLibraryTags(orgId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ContentLibraryTagsResponse>(
    orgId ? `${API_BASE}/tags?orgId=${orgId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    tags: data?.tags ?? [],
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook to create a content library item
 */
export function useCreateContentLibraryItem() {
  const { trigger, isMutating, error } = useSWRMutation<
    ContentLibraryItem,
    Error,
    string,
    { method: string; body: CreateContentLibraryItemDTO }
  >(`${API_BASE}/create-content-library`, mutationFetcher);

  const create = async (data: CreateContentLibraryItemDTO) => {
    return trigger({ method: 'POST', body: data });
  };

  return {
    create,
    isCreating: isMutating,
    error,
  };
}

/**
 * Hook to update a content library item
 */
export function useUpdateContentLibraryItem(orgId: string, kbId: string, itemId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
    ContentLibraryItem,
    Error,
    string,
    { method: string; body: UpdateContentLibraryItemDTO }
  >(
    `${API_BASE}/edit-content-library/${itemId}?orgId=${orgId}&kbId=${kbId}`,
    mutationFetcher
  );

  const update = async (data: UpdateContentLibraryItemDTO) => {
    return trigger({ method: 'PATCH', body: data });
  };

  return {
    update,
    isUpdating: isMutating,
    error,
  };
}

/**
 * Hook to delete (archive) a content library item
 */
export function useDeleteContentLibraryItem(orgId: string, kbId: string, itemId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
    { message: string },
    Error,
    string,
    { method: string; body?: undefined }
  >(
    `${API_BASE}/delete-content-library/${itemId}?orgId=${orgId}&kbId=${kbId}`,
    mutationFetcher
  );

  const deleteItem = async (hardDelete = false) => {
    const url = hardDelete
      ? `${API_BASE}/delete-content-library/${itemId}?orgId=${orgId}&kbId=${kbId}&hardDelete=true`
      : `${API_BASE}/delete-content-library/${itemId}?orgId=${orgId}&kbId=${kbId}`;

    const res = await authFetcher(url, { method: 'DELETE' });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to delete item');
    }
    return res.json();
  };

  return {
    deleteItem,
    isDeleting: isMutating,
    error,
  };
}

/**
 * Hook to approve a content library item
 */

export function useApproveContentLibraryItem(orgId: string, kbId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
  { message: string },
  Error,
    string,
  { method: string; itemId: string }
  >(
    `${API_BASE}/approve`,
      async (url, { arg }) => {
        const response = await authFetcher(
          `${url}/${arg.itemId}?orgId=${orgId}&kbId=${kbId}`,
          {
            method: arg.method,
          }
        );
        return response.json();
      }
  );

  const approve = async (itemId: string) => {
    return trigger({ method: 'POST', itemId });
  };

  return {
    approve,
    isApproving: isMutating,
    error,
  };
}
/**
 * Hook to deprecate a content library item
 */
export function useDeprecateContentLibraryItem(orgId: string, kbId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
    { message: string },
    Error,
    string,
    { method: string; itemId: string }
  >(
    `${API_BASE}/deprecate`,
    async (url, { arg }) => {
      const response = await authFetcher(
        `${url}/${arg.itemId}?orgId=${orgId}&kbId=${kbId}`,
        {
          method: arg.method,
        }
      );
      return response.json();
    }
  );

  const deprecate = async (itemId: string) => {
    return trigger({ method: 'POST', itemId });
  };

  return {
    deprecate,
    isDeprecating: isMutating,
    error,
  };
}

/**
 * Hook to track usage of a content library item
 */
export function useTrackContentLibraryUsage() {
  const trackUsage = async (orgId: string, itemId: string, projectId: string) => {
    const res = await authFetcher(
      `${API_BASE}/track-usage/${itemId}?orgId=${orgId}`,
      {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      }
    );

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to track usage');
    }

    return res.json();
  };

  return { trackUsage };
}