'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  LoadSamOpportunitiesRequest,
  LoadSamOpportunitiesResponse,
  OpportunityItem,
  OpportunityQuery,
} from '@auto-rfp/shared';
import { OpportunityItemSchema } from '@auto-rfp/shared';

const BASE_URL = `${env.BASE_API_URL}/opportunity` as const;

type ErrorShape = Error & { status?: number; details?: any };

const readTextSafe = async (res: any) => {
  try {
    return await res.text();
  } catch {
    return '';
  }
};

const readAuthJson = async <T, >(res: any, fallbackError = 'Request failed'): Promise<T> => {
  if (!res?.ok) {
    const raw = await readTextSafe(res);
    let message = fallbackError;
    let details: any = undefined;

    if (raw) {
      try {
        const j = JSON.parse(raw);
        message = j?.error ?? raw;
        details = j?.details ?? details;
      } catch {
        message = raw;
      }
    }

    const err = new Error(message) as ErrorShape;
    err.status = res?.status;
    err.details = details;
    throw err;
  }

  const raw = await readTextSafe(res);
  if (!raw) return {} as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('Invalid JSON response from API');
  }
};

const normalizeSamSearch = (
  data: LoadSamOpportunitiesResponse | any,
  req: LoadSamOpportunitiesRequest,
): LoadSamOpportunitiesResponse => {
  const d = (data ?? {}) as any;

  const totalRecords =
    typeof d.totalRecords === 'number'
      ? d.totalRecords
      : typeof d.total_records === 'number'
        ? d.total_records
        : typeof d.total === 'number'
          ? d.total
          : 0;

  const limit =
    typeof d.limit === 'number'
      ? d.limit
      : typeof d.pageSize === 'number'
        ? d.pageSize
        : typeof req.limit === 'number'
          ? req.limit
          : 25;

  const offset =
    typeof d.offset === 'number'
      ? d.offset
      : typeof d.start === 'number'
        ? d.start
        : typeof req.offset === 'number'
          ? req.offset
          : 0;

  const opportunities = Array.isArray(d.opportunities)
    ? d.opportunities
    : Array.isArray(d.items)
      ? d.items
      : Array.isArray(d.results)
        ? d.results
        : [];

  return { totalRecords, limit, offset, opportunities } as LoadSamOpportunitiesResponse;
};

const encodeNextToken = (token?: string | null) => (token ? encodeURIComponent(token) : undefined);

const buildListUrl = (args: { orgId?: string | null; projectId: string; limit?: number; nextToken?: string | null }) => {
  const u = new URL(`${BASE_URL}/get-opportunities`);
  u.searchParams.set('projectId', args.projectId);
  if (args.limit) u.searchParams.set('limit', String(args.limit));
  const nt = encodeNextToken(args.nextToken);
  if (nt) u.searchParams.set('nextToken', nt);
  if (args.orgId) u.searchParams.set('orgId', args.orgId);
  return u.toString();
};

const dedupeOpportunities = (items: OpportunityItem[]) => {
  const seen = new Set<string>();
  return items.filter((it: any) => {
    const k =
      (it?.PK && it?.SK ? `${it.PK}#${it.SK}` : undefined) ??
      it?.oppId ??
      it?.id ??
      JSON.stringify([it?.noticeId, it?.solicitationNumber, it?.title, it?.createdAt]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export function useSearchOpportunities(orgId?: string) {
  const baseUrl = `${env.BASE_API_URL}/samgov/search-opportunities`;
  const url = orgId ? `${baseUrl}?orgId=${encodeURIComponent(orgId)}` : baseUrl;
  
  return useSWRMutation<LoadSamOpportunitiesResponse, ErrorShape, string, LoadSamOpportunitiesRequest>(
    url,
    async (url: string, { arg }: { arg: LoadSamOpportunitiesRequest }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      const raw = await readAuthJson<any>(res, 'Failed to search SAM.gov opportunities');
      return normalizeSamSearch(raw, arg);
    },
  );
}

export type ListOpportunitiesResponse = {
  ok: boolean;
  items: OpportunityItem[];
  nextToken: string | null;
};

export function useOpportunitiesList(args: OpportunityQuery) {
  const orgId = args?.orgId;
  const projectId = args?.projectId;
  const limit = args?.limit ?? 25;

  const key = projectId ? buildListUrl({ orgId, projectId, limit }) : null;

  const { data, error, isLoading, mutate } = useSWR<ListOpportunitiesResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url, { method: 'GET' });
      const body = await readAuthJson<any>(res, 'Failed to load opportunities');

      return {
        ok: Boolean(body.ok),
        items: (body.items ?? []) as OpportunityItem[],
        nextToken: (body.nextToken ?? null) as string | null,
      };
    },
    { revalidateOnFocus: false },
  );

  const loadMore = async () => {
    if (!projectId) return;
    const nextToken = data?.nextToken;
    if (!nextToken) return;

    const res = await authFetcher(buildListUrl({ orgId, projectId, limit, nextToken }), { method: 'GET' });
    const body = await readAuthJson<any>(res, 'Failed to load more opportunities');

    const more: ListOpportunitiesResponse = {
      ok: Boolean(body.ok),
      items: (body.items ?? []) as OpportunityItem[],
      nextToken: (body.nextToken ?? null) as string | null,
    };

    const merged = dedupeOpportunities([...(data?.items ?? []), ...(more.items ?? [])]);

    await mutate({ ok: true, items: merged, nextToken: more.nextToken }, { revalidate: false });
  };

  return {
    items: data?.items ?? [],
    nextToken: data?.nextToken ?? null,
    isLoading,
    error: error as ErrorShape | undefined,
    refresh: () => mutate(),
    loadMore,
    canLoadMore: Boolean(data?.nextToken),
  };
}

export type CreateOpportunityResponse = {
  ok: true;
  oppId: string;
  item: OpportunityItem;
};

export function useCreateOpportunity() {
  return useSWRMutation<CreateOpportunityResponse, ErrorShape, string, OpportunityItem>(
    `${BASE_URL}/create-opportunity`,
    async (url: string, { arg }: { arg: OpportunityItem }) => {
      const parsed = OpportunityItemSchema.safeParse(arg);
      if (!parsed.success) {
        const err = new Error('Invalid opportunity payload') as ErrorShape;
        err.status = 400;
        err.details = parsed.error.flatten();
        throw err;
      }

      const res = await authFetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      return readAuthJson<CreateOpportunityResponse>(res, 'Failed to create opportunity');
    },
  );
}

export function useOpportunity(projectId: string | null, oppId: string | null, orgId?: string) {
  const shouldFetch = !!projectId && !!oppId;

  const url = shouldFetch
    ? `${env.BASE_API_URL}/opportunity/get-opportunity?projectId=${encodeURIComponent(projectId!)}&oppId=${encodeURIComponent(oppId!)}&orgId=${orgId}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<OpportunityItem>(
    url,
    async (u: string) => {
      const res = await authFetcher(u);
      const raw = await res.text().catch(() => '');

      if (!res.ok) {
        throw new Error(raw || 'Failed to load opportunity');
      }

      const body = raw ? JSON.parse(raw) : {};
      // lambda returns extra fields (questionFiles). Ignore them and validate the opportunity shape.
      const parsed = OpportunityItemSchema.safeParse(body);
      if (!parsed.success) {
        const err = new Error('Invalid opportunity payload') as Error & { details?: any };
        (err as any).details = parsed.error.flatten();
        throw err;
      }

      return parsed.data;
    },
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );

  return {
    data,
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}

export type SamGovDescriptionResponse = {
  description?: string;
  content?: string;
  contentType?: string;
};

export function useSamGovDescription() {
  return useSWRMutation<SamGovDescriptionResponse, ErrorShape, string, { descriptionUrl: string }>(
    `${env.BASE_API_URL}/samgov/opportunity-description`,
    async (url: string, { arg }: { arg: { descriptionUrl: string } }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptionUrl: arg.descriptionUrl }),
      });

      return readAuthJson<SamGovDescriptionResponse>(res, 'Failed to load description');
    },
  );
}

export type DeleteOpportunityResponse = {
  ok: true;
  message: string;
};

export function useDeleteOpportunity() {
  return useSWRMutation<DeleteOpportunityResponse, ErrorShape, string, { projectId: string; oppId: string; orgId: string }>(
    `${BASE_URL}/delete-opportunity`,
    async (url: string, { arg }: { arg: { projectId: string; oppId: string; orgId: string } }) => {
      const { projectId, oppId, orgId } = arg;
      const deleteUrl = `${url}?projectId=${encodeURIComponent(projectId)}&oppId=${encodeURIComponent(oppId)}&orgId=${encodeURIComponent(orgId)}`;

      const res = await authFetcher(deleteUrl, {
        method: 'DELETE',
      });

      return readAuthJson<DeleteOpportunityResponse>(res, 'Failed to delete opportunity');
    },
  );
}
