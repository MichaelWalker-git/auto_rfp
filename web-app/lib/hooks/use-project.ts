"use client";

import useSWR from "swr";
import { fetchAuthSession } from "aws-amplify/auth";
import { env } from "@/lib/env";
import { RfpDocument } from '@/types/api';

const authedFetcher = async <T>(url: string): Promise<T> => {
  let token: string | undefined;
  const session = await fetchAuthSession();
  token = session.tokens?.idToken?.toString();

  const res = await fetch(url, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to load ${url}`);
  }

  return res.json();
};


export function useProject(projectId: string | null) {
  const shouldFetch = !!projectId;

  const { data, error, isLoading, mutate } = useSWR<any>(
    shouldFetch
      ? `${env.BASE_API_URL}/project/get-project/${projectId}`
      : null,
    authedFetcher,
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