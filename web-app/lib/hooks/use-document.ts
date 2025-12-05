'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';
import {
  CreateDocumentDTO,
  UpdateDocumentDTO,
  DeleteDocumentDTO,
  DocumentItem
} from '@/lib/schemas/document';

//
// ================================
// Helper: authorized fetch
// ================================
//

async function authorizedFetch(url: string, options: RequestInit = {}) {
  let token: string | undefined;

  if (typeof window !== 'undefined') {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString();
  }

  return fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: token } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

const BASE = `${env.BASE_API_URL}/document`;

//
// ================================
// Generic fetcher
// ================================
//

const fetcher = async (url: string) => {
  const res = await authorizedFetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err: any = new Error('Failed request');
    err.status = res.status;
    err.details = text;
    throw err;
  }

  return res.json();
};

//
// ================================
// CREATE Document
// ================================
//

export function useCreateDocument() {
  return useSWRMutation(
    `${BASE}/create-document`,
    async (url, { arg }: { arg: CreateDocumentDTO }) => {
      const res = await authorizedFetch(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to create document');
      }

      return res.json() as Promise<DocumentItem>;
    }
  );
}

//
// ================================
// UPDATE Document
// ================================
//

export function useUpdateDocument() {
  return useSWRMutation(
    `${BASE}/update-document`,
    async (url, { arg }: { arg: UpdateDocumentDTO }) => {
      const res = await authorizedFetch(url, {
        method: 'PATCH',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to update document');
      }

      return res.json() as Promise<DocumentItem>;
    }
  );
}

//
// ================================
// DELETE Document
// ================================
//

export function useDeleteDocument() {
  return useSWRMutation(
    `${BASE}/delete-document`,
    async (url, { arg }: { arg: DeleteDocumentDTO }) => {
      const res = await authorizedFetch(url, {
        method: 'DELETE',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to delete document');
      }

      return res.json();
    }
  );
}

//
// ================================
// LIST Documents for KB
// ================================
//

export function useDocumentsByKb(knowledgeBaseId: string | null) {
  const shouldFetch = !!knowledgeBaseId;

  const { data, error, isLoading, mutate } = useSWR<DocumentItem[]>(
    shouldFetch
      ? `${BASE}/get-documents?kbId=${knowledgeBaseId}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return { data, error, isLoading, mutate };
}

//
// ================================
// GET single Document
// ================================
//

export function useDocument(docId: string | null, kbId: string | null) {
  const shouldFetch = !!docId && !!kbId;

  const { data, error, isLoading, mutate } = useSWR<DocumentItem>(
    shouldFetch
      ? `${BASE}/get-document?id=${docId}&kbId=${kbId}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return { data, error, isLoading, mutate };
}


export interface IndexDocumentDTO {
  documentId: string;
  knowledgeBaseId: string;
}

export interface IndexDocumentResponse {
  status: 'queued' | 'started' | 'completed' | 'error';
  message?: string;
}

export function useIndexDocument() {
  return useSWRMutation<
    IndexDocumentResponse,
    any,
    string,
    IndexDocumentDTO
  >(
    `${BASE}/index-document`,
    async (url, { arg }) => {
      const res = await authorizedFetch(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const error: any = new Error(
          text || 'Failed to index document',
        );
        error.status = res.status;
        throw error;
      }

      return res.json() as Promise<IndexDocumentResponse>;
    },
  );
}

export interface StartDocumentPipelineDTO {
  documentId: string;
}

export interface StartDocumentPipelineResponse {
  executionArn: string;
  startDate: string;
  message?: string;
}

export function useStartDocumentPipeline() {
  return useSWRMutation<
    StartDocumentPipelineResponse,
    any,
    string,
    StartDocumentPipelineDTO
  >(
    `${BASE}/start-document-pipeline`,
    async (url, { arg }) => {
      const res = await authorizedFetch(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      if (res.status !== 202) {
        const text = await res.text().catch(() => '');
        const error: any = new Error(
          text || 'Failed to start document pipeline',
        );
        error.status = res.status;
        throw error;
      }

      return res.json() as Promise<StartDocumentPipelineResponse>;
    },
  );
}
