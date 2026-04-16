'use client';

import useSWR from 'swr';
import { apiFetcher, apiMutate, buildApiUrl } from './api-helpers';
import type {
  ExtractionJob,
  PastProjectDraft,
  LaborRateDraft,
  BOMItemDraft,
  ExtractionTargetType,
} from '@auto-rfp/core';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ExtractionJobResponse {
  ok: boolean;
  job?: ExtractionJob;
  error?: string;
}

interface ExtractionJobsResponse {
  ok: boolean;
  jobs: ExtractionJob[];
  count: number;
}

// Generic drafts response - draft type is inferred from draftType param
interface DraftsResponse<T> {
  ok: boolean;
  drafts: T[];
  count: number;
  draftType?: ExtractionTargetType;
}

// Draft type mapping for type inference
type DraftTypeMap = {
  PAST_PERFORMANCE: PastProjectDraft;
  LABOR_RATE: LaborRateDraft;
  BOM_ITEM: BOMItemDraft;
};

interface StartExtractionParams {
  orgId: string;
  projectId?: string;
  sourceType: 'DIRECT_UPLOAD' | 'KB_EXTRACTION';
  targetType: 'PAST_PERFORMANCE' | 'LABOR_RATE' | 'BOM_ITEM';
  sourceFiles?: Array<{
    fileName: string;
    s3Key: string;
    fileSize: number;
  }>;
}

interface ConfirmDraftParams {
  orgId: string;
  draftId: string;
  projectName?: string;
  updates?: Record<string, unknown>;
  draftType?: 'PAST_PERFORMANCE' | 'LABOR_RATE' | 'BOM_ITEM';
}

interface DiscardDraftParams {
  orgId: string;
  draftId: string;
  draftType?: 'PAST_PERFORMANCE' | 'LABOR_RATE' | 'BOM_ITEM';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useExtractionJob
// ─────────────────────────────────────────────────────────────────────────────

export const useExtractionJob = (orgId: string | undefined, jobId: string | undefined) => {
  const shouldFetch = !!orgId && !!jobId;
  const url = shouldFetch ? buildApiUrl('extraction/job', { orgId, jobId }) : null;

  const { data, error, isLoading, mutate } = useSWR<ExtractionJobResponse>(
    url,
    apiFetcher,
    {
      refreshInterval: (data) => {
        // Poll every 2s while job is running, stop when complete/failed
        if (data?.job?.status === 'PROCESSING' || data?.job?.status === 'PENDING') {
          return 2000;
        }
        return 0;
      },
    }
  );

  return {
    job: data?.job,
    isLoading,
    error: error ?? (data?.ok === false ? new Error(data.error ?? 'Unknown error') : undefined),
    refresh: mutate,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useDrafts (generic draft fetching with type inference)
// ─────────────────────────────────────────────────────────────────────────────

export const useDrafts = <T extends keyof DraftTypeMap = 'PAST_PERFORMANCE'>(
  orgId: string | undefined,
  options?: { status?: string; draftType?: T }
) => {
  const shouldFetch = !!orgId;
  const url = shouldFetch 
    ? buildApiUrl('extraction/drafts', { 
        orgId, 
        status: options?.status,
        draftType: options?.draftType,
      }) 
    : null;

  const { data, error, isLoading, mutate } = useSWR<DraftsResponse<DraftTypeMap[T]>>(
    url,
    apiFetcher
  );

  return {
    drafts: data?.drafts ?? [] as DraftTypeMap[T][],
    count: data?.count ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useStartExtraction
// ─────────────────────────────────────────────────────────────────────────────

export const useStartExtraction = () => {
  const startExtraction = async (params: StartExtractionParams): Promise<ExtractionJob> => {
    const response = await apiMutate<ExtractionJobResponse, StartExtractionParams>(
      buildApiUrl('extraction/start-job'),
      'POST',
      params
    );

    if (!response.ok || !response.job) {
      throw new Error(response.error ?? 'Failed to start extraction job');
    }

    return response.job;
  };

  return { startExtraction };
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useConfirmDraft
// ─────────────────────────────────────────────────────────────────────────────

export const useConfirmDraft = () => {
  const confirmDraft = async (params: ConfirmDraftParams): Promise<void> => {
    const response = await apiMutate<{ ok: boolean; error?: string }, ConfirmDraftParams & { action: string }>(
      buildApiUrl('extraction/drafts'),
      'POST',
      { ...params, action: 'confirm' }
    );

    if (!response.ok) {
      throw new Error(response.error ?? 'Failed to confirm draft');
    }
  };

  return { confirmDraft };
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useDiscardDraft
// ─────────────────────────────────────────────────────────────────────────────

export const useDiscardDraft = () => {
  const discardDraft = async (params: DiscardDraftParams): Promise<void> => {
    const response = await apiMutate<{ ok: boolean; error?: string }, DiscardDraftParams & { action: string }>(
      buildApiUrl('extraction/drafts'),
      'POST',
      { ...params, action: 'discard' }
    );

    if (!response.ok) {
      throw new Error(response.error ?? 'Failed to discard draft');
    }
  };

  return { discardDraft };
};
