'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { CreateDocumentDTO, DeleteDocumentDTO, DocumentItem, UpdateDocumentDTO } from '@/lib/schemas/document';
import { authFetcher } from '@/lib/auth/auth-fetcher';


const BASE = `${env.BASE_API_URL}/document`;

const fetcher = async (url: string) => {
  const res = await authFetcher(url);
  return res.json();
};

export function useCreateDocument() {
  return useSWRMutation(
    `${BASE}/create-document`,
    async (url, { arg }: { arg: CreateDocumentDTO }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

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
      const res = await authFetcher(url, {
        method: 'PATCH',
        body: JSON.stringify(arg),
      });

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
      const res = await authFetcher(url, {
        method: 'DELETE',
        body: JSON.stringify(arg),
      });

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
      const res = await authFetcher(url, {
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
  knowledgeBaseId: string;
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
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      return res.json() as Promise<StartDocumentPipelineResponse>;
    },
  );
}
