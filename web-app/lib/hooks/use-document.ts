'use client';

import useSWRMutation from 'swr/mutation';
import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { CreateDocumentDTO, DeleteDocumentDTO, DocumentItem, UpdateDocumentDTO } from '@auto-rfp/shared';
import { breadcrumbs } from '@/lib/sentry';

// ─── GET Hooks ───

export function useDocumentsByKb(knowledgeBaseId: string | null) {
  return useApi<DocumentItem[]>(
    knowledgeBaseId ? ['documents', knowledgeBaseId] : null,
    knowledgeBaseId ? buildApiUrl('document/get-documents', { kbId: knowledgeBaseId }) : null,
  );
}

export function useDocument(docId: string | null, kbId: string | null) {
  return useApi<DocumentItem>(
    docId && kbId ? ['document', kbId, docId] : null,
    docId && kbId ? buildApiUrl('document/get-document', { id: docId, kbId }) : null,
  );
}

// ─── Mutation Hooks ───

export function useCreateDocument() {
  return useSWRMutation<DocumentItem, ApiError, string, CreateDocumentDTO>(
    buildApiUrl('document/create-document'),
    async (url, { arg }) => {
      breadcrumbs.documentUploadStarted(arg.name, arg.knowledgeBaseId);
      const doc = await apiMutate<DocumentItem>(url, 'POST', arg);
      breadcrumbs.documentUploadCompleted(doc.id, doc.name);
      return doc;
    },
  );
}

export function useUpdateDocument() {
  return useSWRMutation<DocumentItem, ApiError, string, UpdateDocumentDTO>(
    buildApiUrl('document/update-document'),
    async (url, { arg }) => apiMutate<DocumentItem>(url, 'PATCH', arg),
  );
}

export function useDeleteDocument() {
  return useSWRMutation<unknown, ApiError, string, DeleteDocumentDTO>(
    buildApiUrl('document/delete-document'),
    async (url, { arg }) => {
      const result = await apiMutate(url, 'DELETE', arg);
      breadcrumbs.documentDeleted(arg.id);
      return result;
    },
  );
}

// ─── Pipeline Hooks ───

export interface IndexDocumentDTO {
  documentId: string;
  knowledgeBaseId: string;
}

export interface IndexDocumentResponse {
  status: 'queued' | 'started' | 'completed' | 'error';
  message?: string;
}

export function useIndexDocument() {
  return useSWRMutation<IndexDocumentResponse, ApiError, string, IndexDocumentDTO>(
    buildApiUrl('document/index-document'),
    async (url, { arg }) => apiMutate<IndexDocumentResponse>(url, 'POST', arg),
  );
}

export interface StartDocumentPipelineDTO {
  orgId?: string;
  documentId: string;
  knowledgeBaseId: string;
}

export interface StartDocumentPipelineResponse {
  executionArn: string;
  startDate: string;
  message?: string;
}

// ─── Download with Ownership Check ───

export interface DownloadDocumentResponse {
  url: string;
  method: string;
  fileName: string;
  expiresIn: number;
}

export function useDownloadDocument() {
  return useSWRMutation<DownloadDocumentResponse, ApiError, string, { documentId: string; kbId: string }>(
    buildApiUrl('document/download'),
    async (_url, { arg }) => {
      const url = buildApiUrl('document/download', { id: arg.documentId, kbId: arg.kbId });
      const { apiFetcher } = await import('./api-helpers');
      return apiFetcher<DownloadDocumentResponse>(url);
    },
  );
}

export function useStartDocumentPipeline() {
  return useSWRMutation<StartDocumentPipelineResponse, ApiError, string, StartDocumentPipelineDTO>(
    buildApiUrl('document/start-document-pipeline'),
    async (url, { arg }) => {
      breadcrumbs.documentProcessingStarted(arg.documentId);
      return apiMutate<StartDocumentPipelineResponse>(url, 'POST', arg);
    },
  );
}
