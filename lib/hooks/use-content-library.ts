import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

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

export interface ContentLibraryCategoriesResponse {
  categories: Array<{ name: string; count: number }>;
}

export interface ContentLibraryTagsResponse {
  tags: Array<{ name: string; count: number }>;
}

export interface CreateContentLibraryItemDTO {
  orgId: string;
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
  query?: string;
  category?: string;
  tags?: string[];
  approvalStatus?: ApprovalStatus;
  excludeArchived?: boolean;
  limit?: number;
  offset?: number;
}

// API base URL
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

// Generic fetcher
const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'An error occurred while fetching data');
  }
  const json = await res.json();
  return json.data;
};

// POST/PATCH/DELETE fetcher
async function mutationFetcher<T>(
  url: string,
  { arg }: { arg: { method: string; body?: unknown } }
): Promise<T> {
  const res = await fetch(url, {
    method: arg.method,
    headers: { 'Content-Type': 'application/json' },
    body: arg.body ? JSON.stringify(arg.body) : undefined,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed: ${res.status}`);
  }

  const json = await res.json();
  return json.data || json;
}

/**
 * Hook to list/search content library items
 */
export function useContentLibraryItems(params: SearchContentLibraryParams | null) {
  const queryParams = params
    ? new URLSearchParams({
        orgId: params.orgId,
        ...(params.query && { query: params.query }),
        ...(params.category && { category: params.category }),
        ...(params.tags?.length && { tags: params.tags.join(',') }),
        ...(params.approvalStatus && { approvalStatus: params.approvalStatus }),
        ...(params.excludeArchived !== undefined && { excludeArchived: String(params.excludeArchived) }),
        ...(params.limit !== undefined && { limit: String(params.limit) }),
        ...(params.offset !== undefined && { offset: String(params.offset) }),
      }).toString()
    : null;

  const { data, error, isLoading, mutate } = useSWR<ContentLibraryListResponse>(
    params ? `${API_BASE}/content-library/items?${queryParams}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

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
      ? `${API_BASE}/content-library/items/${itemId}?orgId=${orgId}`
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
  const { data, error, isLoading, mutate } = useSWR<ContentLibraryCategoriesResponse>(
    orgId ? `${API_BASE}/content-library/categories?orgId=${orgId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    categories: data?.categories ?? [],
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
    orgId ? `${API_BASE}/content-library/tags?orgId=${orgId}` : null,
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
  >(`${API_BASE}/content-library/items`, mutationFetcher);

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
export function useUpdateContentLibraryItem(orgId: string, itemId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
    ContentLibraryItem,
    Error,
    string,
    { method: string; body: UpdateContentLibraryItemDTO }
  >(
    `${API_BASE}/content-library/items/${itemId}?orgId=${orgId}`,
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
export function useDeleteContentLibraryItem(orgId: string, itemId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
    { message: string },
    Error,
    string,
    { method: string; body?: undefined }
  >(
    `${API_BASE}/content-library/items/${itemId}?orgId=${orgId}`,
    mutationFetcher
  );

  const deleteItem = async (hardDelete = false) => {
    const url = hardDelete
      ? `${API_BASE}/content-library/items/${itemId}?orgId=${orgId}&hardDelete=true`
      : `${API_BASE}/content-library/items/${itemId}?orgId=${orgId}`;

    const res = await fetch(url, { method: 'DELETE' });
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
export function useApproveContentLibraryItem(orgId: string, itemId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
    { message: string },
    Error,
    string,
    { method: string; body?: unknown }
  >(
    `${API_BASE}/content-library/items/${itemId}/approve?orgId=${orgId}`,
    mutationFetcher
  );

  const approve = async () => {
    return trigger({ method: 'POST' });
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
export function useDeprecateContentLibraryItem(orgId: string, itemId: string) {
  const { trigger, isMutating, error } = useSWRMutation<
    { message: string },
    Error,
    string,
    { method: string; body?: unknown }
  >(
    `${API_BASE}/content-library/items/${itemId}/deprecate?orgId=${orgId}`,
    mutationFetcher
  );

  const deprecate = async () => {
    return trigger({ method: 'POST' });
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
    const res = await fetch(
      `${API_BASE}/content-library/items/${itemId}/track-usage?orgId=${orgId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
