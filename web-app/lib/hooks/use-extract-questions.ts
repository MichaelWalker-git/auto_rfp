// src/lib/hooks/use-extract-questions.ts
'use client';

import useSWRMutation, { SWRMutationConfiguration } from 'swr/mutation';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';

export interface ExtractQuestionsPayload {
  s3Key: string;
  projectId: string;
  s3Bucket?: string;
}

export interface ExtractQuestionsResult {
  sections: Array<{
    id: string;
    title: string;
    description?: string | null;
    questions: Array<{
      id: string;
      question: string;
    }>;
  }>;
}

// Mutation fetcher – SWR passes { arg } as the second param
async function extractQuestionsFetcher<T>(
  url: string,
  { arg }: { arg: ExtractQuestionsPayload },
): Promise<T> {
  let token: string | undefined;

  if (typeof window !== 'undefined') {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString();
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(arg),
  });

  if (!res.ok) {
    const error: any = new Error('Failed to extract questions');
    error.status = res.status;
    try {
      error.details = await res.json();
    } catch {}
    throw error;
  }

  return res.json();
}

/**
 * useExtractQuestions
 * - no params on hook
 * - returns extractQuestions(payload) you call manually
 */
export function useExtractQuestions<T = ExtractQuestionsResult>() {
  const url = `${env.BASE_API_URL}/question/extract-questions`;

  //           <Data,   Error, Key,    ExtraArg>
  const { trigger, data, error, isMutating, reset } = useSWRMutation<
    T,
    any,
    string,
    ExtractQuestionsPayload
  >(url, extractQuestionsFetcher<T>, {
    revalidate: false,
  });

  return {
    extractQuestions: (payload: ExtractQuestionsPayload) => trigger(payload),
    data,
    error,
    isLoading: isMutating,
    reset,
  };
}
