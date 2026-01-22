"use client";

import useSWR from "swr";
import useSWRMutation from 'swr/mutation';
import { env } from "@/lib/env";
import { authFetcher } from '@/lib/auth/auth-fetcher';

export function useProject(projectId: string | null) {
  const shouldFetch = !!projectId;

  const { data, error, isLoading, mutate } = useSWR<any>(
    shouldFetch
      ? `${env.BASE_API_URL}/project/get-project/${projectId}`
      : null,
    authFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  return {
    data,
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}


export function useDeleteProject() {
  return useSWRMutation<
    void,
    any,
    string,
    { projectId: string, orgId: string }
  >(
    `${env.BASE_API_URL}/project/delete-project`,
    async (url, { arg: {orgId, projectId} }) => {
      const res = await authFetcher(`${url}?projectId=${projectId}&orgId=${orgId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to delete project') as Error & {
          status?: number;
        };
        (error as any).status = res.status;
        throw error;
      }

      // some lambdas return empty body
      const raw = await res.text().catch(() => '');
      if (!raw) return { success: true };

      try {
        return JSON.parse(raw);
      } catch {
        return { success: true };
      }
    },
  );
}