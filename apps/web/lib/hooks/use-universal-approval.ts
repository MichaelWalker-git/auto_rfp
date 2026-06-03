'use client';
import useSWR from 'swr';
import { useState } from 'react';
import { buildApiUrl, apiMutate, apiFetcher } from '@/lib/hooks/api-helpers';
import type {
  UniversalApprovalHistoryResponse,
  ApprovableEntityType,
  RequestUniversalApproval,
  SubmitUniversalReview,
} from '@auto-rfp/core';

export const useUniversalApprovalHistory = (
  orgId: string,
  entityType: ApprovableEntityType,
  entitySK: string,
) => {
  const url = buildApiUrl(
    `universal-approval/history?orgId=${orgId}&entityType=${entityType}&entitySK=${encodeURIComponent(entitySK)}`,
  );
  const { data, error, mutate } = useSWR<UniversalApprovalHistoryResponse>(
    orgId && entitySK ? url : null,
    () => apiFetcher<UniversalApprovalHistoryResponse>(url),
  );

  return {
    approvals: data?.items ?? [],
    count: data?.count ?? 0,
    activeApproval: data?.activeApproval ?? null,
    isLoading: !error && !data,
    error,
    refresh: mutate,
  };
};

export const useRequestUniversalApproval = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestApproval = async (data: RequestUniversalApproval) => {
    setIsLoading(true);
    setError(null);

    try {
      return await apiMutate<unknown, RequestUniversalApproval>(
        buildApiUrl('universal-approval/request'),
        'POST',
        data,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to request approval';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    requestApproval,
    isLoading,
    error,
  };
};

export const useSubmitUniversalReview = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReview = async (data: SubmitUniversalReview) => {
    setIsLoading(true);
    setError(null);

    try {
      return await apiMutate<unknown, SubmitUniversalReview>(
        buildApiUrl('universal-approval/submit-review'),
        'POST',
        data,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit review';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    submitReview,
    isLoading,
    error,
  };
};

// Helper hook for RFP documents (backward compatibility)
export const useRfpDocumentApproval = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
) => {
  const entitySK = `${orgId}#${projectId}#${opportunityId}#${documentId}`;
  return useUniversalApprovalHistory(orgId, 'rfp-document', entitySK);
};

// Helper hook for executive briefs
export const useBriefApproval = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  briefId: string,
) => {
  const entitySK = `${orgId}#${projectId}#${opportunityId}#${briefId}`;
  return useUniversalApprovalHistory(orgId, 'brief', entitySK);
};

// Helper hook for opportunities
export const useOpportunityApproval = (
  orgId: string,
  projectId: string,
  opportunityId: string,
) => {
  const entitySK = `${orgId}#${projectId}#${opportunityId}`;
  return useUniversalApprovalHistory(orgId, 'opportunity', entitySK);
};

// Helper hook for submissions
export const useSubmissionApproval = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  submissionId: string,
) => {
  const entitySK = `${orgId}#${projectId}#${opportunityId}#${submissionId}`;
  return useUniversalApprovalHistory(orgId, 'submission', entitySK);
};

// Helper hook for content library items
export const useContentLibraryApproval = (
  orgId: string,
  contentId: string,
) => {
  const entitySK = `${orgId}#${contentId}`;
  return useUniversalApprovalHistory(orgId, 'content-library', entitySK);
};

// Helper hook for templates
export const useTemplateApproval = (
  orgId: string,
  templateId: string,
) => {
  const entitySK = `${orgId}#${templateId}`;
  return useUniversalApprovalHistory(orgId, 'template', entitySK);
};