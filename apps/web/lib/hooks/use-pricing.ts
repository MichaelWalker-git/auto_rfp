'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  LaborRate,
  CreateLaborRate,
  UpdateLaborRate,
  BOMItem,
  CreateBOMItem,
  StaffingPlan,
  CreateStaffingPlan,
  CostEstimate,
  CalculateEstimateRequest,
  PricingBidAnalysis,
} from '@auto-rfp/core';

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return { ok: true } as T;
  }
};

const putJson = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return { ok: true } as T;
  }
};

const deleteJson = async <T>(url: string): Promise<T> => {
  const res = await authFetcher(url, { method: 'DELETE' });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return { ok: true } as T;
  }
};

const fetcher = async <T>(url: string): Promise<T> => {
  const res = await authFetcher(url);
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(raw || 'Request failed');
  }
  return res.json() as Promise<T>;
};

const BASE = `${env.BASE_API_URL}/pricing`;

// ─── Labor Rates ───

export const useLaborRates = (orgId?: string) => {
  const url = orgId ? `${BASE}/labor-rates?orgId=${orgId}` : null;
  return useSWR<{ laborRates: LaborRate[] }>(url, fetcher);
};

export const useCreateLaborRate = (orgId?: string) => {
  return useSWRMutation<{ laborRate: LaborRate }, Error, string, CreateLaborRate>(
    `${BASE}/labor-rates${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<{ laborRate: LaborRate }>(url, arg),
  );
};

export const useUpdateLaborRate = () => {
  return useSWRMutation<{ laborRate: LaborRate }, Error, string, UpdateLaborRate>(
    `${BASE}/labor-rates`,
    (url, { arg }) => putJson<{ laborRate: LaborRate }>(url, arg),
  );
};

export const useDeleteLaborRate = (orgId?: string) => {
  return useSWRMutation<{ message: string }, Error, string, { laborRateId: string }>(
    `${BASE}/labor-rates`,
    (url, { arg }) => deleteJson<{ message: string }>(`${url}?orgId=${orgId}&laborRateId=${arg.laborRateId}`),
  );
};

// ─── BOM Items ───

export const useBOMItems = (orgId?: string, category?: string) => {
  const url = orgId ? `${BASE}/bom-items?orgId=${orgId}${category ? `&category=${category}` : ''}` : null;
  return useSWR<{ bomItems: BOMItem[] }>(url, fetcher);
};

export const useCreateBOMItem = (orgId?: string) => {
  return useSWRMutation<{ bomItem: BOMItem }, Error, string, CreateBOMItem>(
    `${BASE}/bom-items${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<{ bomItem: BOMItem }>(url, arg),
  );
};

export const useDeleteBOMItem = (orgId?: string) => {
  return useSWRMutation<{ message: string }, Error, string, { bomItemId: string }>(
    `${BASE}/bom-items`,
    (url, { arg }) => deleteJson<{ message: string }>(`${url}?orgId=${orgId}&bomItemId=${arg.bomItemId}`),
  );
};

// ─── Staffing Plans ───

export const useStaffingPlans = (orgId?: string, projectId?: string, opportunityId?: string) => {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  if (projectId) params.set('projectId', projectId);
  if (opportunityId) params.set('opportunityId', opportunityId);
  const url = orgId && projectId ? `${BASE}/staffing-plans?${params.toString()}` : null;
  return useSWR<{ staffingPlans: StaffingPlan[] }>(url, fetcher);
};

export const useCreateStaffingPlan = () => {
  return useSWRMutation<{ staffingPlan: StaffingPlan }, Error, string, CreateStaffingPlan>(
    `${BASE}/staffing-plans`,
    (url, { arg }) => postJson<{ staffingPlan: StaffingPlan }>(url, arg),
  );
};

export const useDeleteStaffingPlan = () => {
  return useSWRMutation<{ message: string }, Error, string, {
    orgId: string;
    projectId: string;
    opportunityId: string;
    staffingPlanId: string;
  }>(
    `${BASE}/staffing-plans`,
    (url, { arg }) => {
      const params = new URLSearchParams(arg);
      return deleteJson<{ message: string }>(`${url}?${params.toString()}`);
    },
  );
};

// ─── Cost Estimates ───

export const useCostEstimates = (orgId?: string, projectId?: string, opportunityId?: string) => {
  const url = orgId && projectId && opportunityId
    ? `${BASE}/estimates?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}`
    : null;
  return useSWR<{ estimates: CostEstimate[] }>(url, fetcher);
};

export const useCalculateEstimate = () => {
  return useSWRMutation<{ estimate: CostEstimate }, Error, string, CalculateEstimateRequest>(
    `${BASE}/calculate-estimate`,
    (url, { arg }) => postJson<{ estimate: CostEstimate }>(url, arg),
  );
};

// ─── Bid/No-Bid Analysis ───

export const useAnalyzeBid = () => {
  return useSWRMutation<{ analysis: PricingBidAnalysis }, Error, string, {
    orgId: string;
    projectId: string;
    opportunityId: string;
    estimateId: string;
    priceToWinEstimate?: number;
  }>(
    `${BASE}/analyze-bid`,
    (url, { arg }) => postJson<{ analysis: PricingBidAnalysis }>(url, arg),
  );
};

// ─── Export ───

export const useExportPricing = () => {
  return useSWRMutation<{ downloadUrl: string; format: string; expiresAt: string }, Error, string, {
    orgId: string;
    projectId: string;
    opportunityId: string;
    estimateId: string;
    format?: 'CSV' | 'JSON';
  }>(
    `${BASE}/export`,
    (url, { arg }) => postJson<{ downloadUrl: string; format: string; expiresAt: string }>(url, arg),
  );
};

// ─── Executive Brief Pricing ───

export const useGenerateExecutiveBriefPricing = (orgId?: string) => {
  return useSWRMutation<{ ok: boolean }, Error, string, { executiveBriefId: string }>(
    `${env.BASE_API_URL}/brief/generate-pricing${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<{ ok: boolean }>(url, arg),
  );
};
