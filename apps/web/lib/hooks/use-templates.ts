import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type {
  MacroDefinition,
  TemplateSection,
  StylingConfig,
  TemplateVersionMeta,
  TemplateItem,
  TemplateListResponse,
  TemplateCategory,
} from '@auto-rfp/core';

// Re-export types from shared for convenience
export type { MacroDefinition, TemplateSection, StylingConfig, TemplateVersionMeta, TemplateItem, TemplateListResponse, TemplateCategory };

export type TemplateCategoryInfo = {
  name: string;
  label: string;
  count: number;
};

// ================================
// API Base
// ================================

const API_BASE = `${env.BASE_API_URL}/templates`;

// ================================
// Fetchers
// ================================

const fetcher = async (url: string) => {
  const res = await authFetcher(url, { method: 'GET' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch');
  }
  return res.json();
};

const mutationFetcher = async (
  url: string,
  { arg }: { arg: { method: string; body?: unknown } },
) => {
  const res = await authFetcher(url, {
    method: arg.method,
    body: arg.body ? JSON.stringify(arg.body) : undefined,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Request failed');
  }
  return res.json();
};

// ================================
// Hooks
// ================================

export function useTemplates(params: {
  orgId: string;
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
} | null) {
  const entries: Array<[string, string]> = [];
  if (params) {
    entries.push(['orgId', params.orgId]);
    if (params.category) entries.push(['category', params.category]);
    if (params.status) entries.push(['status', params.status]);
    if (params.limit) entries.push(['limit', String(params.limit)]);
    if (params.offset) entries.push(['offset', String(params.offset)]);
  }
  const qs = params ? new URLSearchParams(entries).toString() : null;

  const { data, error, isLoading, mutate } = useSWR<TemplateListResponse>(
    params ? `${API_BASE}/list?${qs}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
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

export function useTemplate(orgId: string | null, templateId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<TemplateItem>(
    orgId && templateId ? `${API_BASE}/get/${templateId}?orgId=${orgId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  return { template: data, isLoading, isError: !!error, error, mutate };
}

export function useCreateTemplate() {
  const { trigger, isMutating, error } = useSWRMutation(
    `${API_BASE}/create`,
    mutationFetcher,
  );
  const create = async (data: unknown) => trigger({ method: 'POST', body: data });
  return { create, isCreating: isMutating, error };
}

export function useUpdateTemplate(orgId: string, templateId: string) {
  const { trigger, isMutating, error } = useSWRMutation(
    `${API_BASE}/update/${templateId}?orgId=${orgId}`,
    mutationFetcher,
  );
  const update = async (data: unknown) => trigger({ method: 'PATCH', body: data });
  return { update, isUpdating: isMutating, error };
}

export function useDeleteTemplate(orgId: string) {
  const deleteTemplate = async (templateId: string) => {
    const res = await authFetcher(
      `${API_BASE}/delete/${templateId}?orgId=${orgId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error('Failed to delete template');
    return res.json();
  };
  return { deleteTemplate };
}

export function useApplyTemplate(orgId: string) {
  const apply = async (templateId: string, body: unknown) => {
    const res = await authFetcher(
      `${API_BASE}/apply/${templateId}?orgId=${orgId}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error('Failed to apply template');
    return res.json();
  };
  return { apply };
}

export function useCloneTemplate(orgId: string) {
  const clone = async (templateId: string, body: unknown) => {
    const res = await authFetcher(
      `${API_BASE}/clone/${templateId}?orgId=${orgId}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error('Failed to clone template');
    return res.json();
  };
  return { clone };
}

export function useTemplateVersions(orgId: string | null, templateId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    orgId && templateId ? `${API_BASE}/versions/${templateId}?orgId=${orgId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  return {
    versions: data?.versions ?? [],
    currentVersion: data?.currentVersion ?? 1,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export function usePublishTemplate(orgId: string) {
  const publish = async (templateId: string) => {
    const res = await authFetcher(
      `${API_BASE}/publish/${templateId}?orgId=${orgId}`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error('Failed to publish template');
    return res.json();
  };
  return { publish };
}

export function useTemplateCategories(orgId: string | null) {
  const { data, error, isLoading } = useSWR<{ categories: TemplateCategoryInfo[] }>(
    orgId ? `${API_BASE}/categories?orgId=${orgId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  return { categories: data?.categories ?? [], isLoading, isError: !!error, error };
}