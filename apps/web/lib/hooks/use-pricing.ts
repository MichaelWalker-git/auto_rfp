'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { 
  LaborRate, 
  CreateLaborRate, 
  BOMItem, 
  CreateBOMItem,
  CostEstimate,
  CalculateEstimateRequest 
} from '@auto-rfp/core';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as any).status = res.status;
    throw err;
  }

  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return { ok: true } as T;
  }
}

const BASE = `${env.BASE_API_URL}/pricing`;

// ─── Labor Rates ───

export const useLaborRates = (orgId?: string) => {
  const url = orgId ? `${BASE}/labor-rates?orgId=${orgId}` : null;
  return useSWR<LaborRate[]>(url, authFetcher);
};

export const useCreateLaborRate = (orgId?: string) => {
  return useSWRMutation<LaborRate, Error, string, CreateLaborRate>(
    `${BASE}/labor-rates${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<LaborRate>(url, arg),
  );
};

// ─── BOM Items ───

export const useBOMItems = (orgId?: string, category?: string) => {
  const url = orgId ? `${BASE}/bom-items?orgId=${orgId}${category ? `&category=${category}` : ''}` : null;
  return useSWR<BOMItem[]>(url, authFetcher);
};

export const useCreateBOMItem = (orgId?: string) => {
  return useSWRMutation<BOMItem, Error, string, CreateBOMItem>(
    `${BASE}/bom-items${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<BOMItem>(url, arg),
  );
};

// ─── Cost Estimates ───

export const useCalculateEstimate = (orgId?: string) => {
  return useSWRMutation<CostEstimate, Error, string, CalculateEstimateRequest>(
    `${BASE}/calculate-estimate${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<CostEstimate>(url, arg),
  );
};

// ─── Executive Brief Pricing ───

export const useGenerateExecutiveBriefPricing = (orgId?: string) => {
  return useSWRMutation<{ ok: boolean }, Error, string, { executiveBriefId: string }>(
    `${env.BASE_API_URL}/brief/generate-pricing${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<{ ok: boolean }>(url, arg),
  );
};
