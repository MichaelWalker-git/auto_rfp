import useSWR from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

export interface AssignedReview {
  approvalId: string;
  orgId: string;
  projectId: string;
  projectName?: string;
  opportunityId?: string;
  documentId?: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  entityIcon?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedByName?: string;
  requestedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  priority?: string;
}

export interface AssignedReviewsResponse {
  reviews: AssignedReview[];
  pendingCount: number;
  completedCount: number;
}

export function useAssignedReviews(orgId: string | null, userId: string | null) {
  const key = orgId && userId 
    ? `${env.BASE_API_URL}/document-approval/assigned-reviews?orgId=${orgId}&userId=${userId}` 
    : null;
    
  const fetcher = async (url: string): Promise<AssignedReviewsResponse> => {
    const response = await authFetcher(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  };
    
  const { data, error, mutate, isLoading } = useSWR<AssignedReviewsResponse>(
    key,
    key ? fetcher : null,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
      revalidateOnFocus: true,
    }
  );

  return {
    reviews: data?.reviews || [],
    pendingCount: data?.pendingCount || 0,
    completedCount: data?.completedCount || 0,
    isLoading,
    error,
    refresh: mutate,
  };
}
