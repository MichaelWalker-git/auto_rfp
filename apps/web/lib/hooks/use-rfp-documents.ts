'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  RFPDocumentItem,
  RFPDocumentType,
  SignatureStatus,
  SignatureDetails,
  EditHistoryEntry,
  CreateRFPDocumentDTO,
  UpdateRFPDocumentDTO,
  RFPExportFormat,
  LinearSyncStatus,
} from '@auto-rfp/core';
import {
  RFP_DOCUMENT_TYPES,
  RFP_DOCUMENT_TYPE_DESCRIPTIONS,
  SIGNATURE_STATUSES,
  LINEAR_SYNC_STATUSES,
  RFP_EXPORT_FORMAT_LABELS,
  RFP_EXPORT_FORMAT_EXTENSIONS,
} from '@auto-rfp/core';

// Re-export types and constants from shared for convenience
export type { RFPDocumentItem, RFPDocumentType, SignatureStatus, SignatureDetails, EditHistoryEntry, LinearSyncStatus };
export type { CreateRFPDocumentDTO, UpdateRFPDocumentDTO };
export type { RFPExportFormat as ExportFormat };
export { RFP_DOCUMENT_TYPES, RFP_DOCUMENT_TYPE_DESCRIPTIONS, SIGNATURE_STATUSES, LINEAR_SYNC_STATUSES };
export { RFP_EXPORT_FORMAT_LABELS as EXPORT_FORMAT_LABELS, RFP_EXPORT_FORMAT_EXTENSIONS as EXPORT_FORMAT_EXTENSIONS };

import { z } from 'zod';
import {
  RFPDocumentItemSchema,
  SignatureStatusSchema,
  SignatureDetailsSchema,
  RFPExportFormatSchema,
} from '@auto-rfp/core';

// ─── Zod-defined response/request schemas ───

const UpdateSignatureStatusDTOSchema = z.object({
  projectId: z.string(),
  opportunityId: z.string(),
  documentId: z.string(),
  signatureStatus: SignatureStatusSchema,
  signatureDetails: SignatureDetailsSchema.nullable().optional(),
});

export type UpdateSignatureStatusDTO = z.infer<typeof UpdateSignatureStatusDTOSchema>;

const RFPDocumentsListResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(RFPDocumentItemSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
});

type RFPDocumentsListResponse = z.infer<typeof RFPDocumentsListResponseSchema>;

const CreateRFPDocumentResponseSchema = z.object({
  ok: z.boolean(),
  document: RFPDocumentItemSchema,
  upload: z.object({
    url: z.string(),
    method: z.string(),
    bucket: z.string(),
    key: z.string(),
    expiresIn: z.number(),
  }).optional(),
});

type CreateRFPDocumentResponse = z.infer<typeof CreateRFPDocumentResponseSchema>;

const RFPDocumentResponseSchema = z.object({
  ok: z.boolean(),
  document: RFPDocumentItemSchema,
});

type RFPDocumentResponse = z.infer<typeof RFPDocumentResponseSchema>;

const PresignedUrlResponseSchema = z.object({
  ok: z.boolean(),
  url: z.string(),
  mimeType: z.string(),
  fileName: z.string(),
  expiresIn: z.number(),
});

type PresignedUrlResponse = z.infer<typeof PresignedUrlResponseSchema>;

const ExportRFPDocumentRequestSchema = z.object({
  projectId: z.string(),
  opportunityId: z.string(),
  documentId: z.string(),
  format: RFPExportFormatSchema,
  options: z.object({
    pageSize: z.enum(['letter', 'a4']).optional(),
    includeTableOfContents: z.boolean().optional(),
    includeCitations: z.boolean().optional(),
    pageLimitsPerSection: z.number().optional(),
  }).optional(),
});

type ExportRFPDocumentRequest = z.infer<typeof ExportRFPDocumentRequestSchema>;

const ExportRFPDocumentResponseSchema = z.object({
  success: z.boolean(),
  document: z.object({ id: z.string(), title: z.string(), documentType: z.string() }),
  export: z.object({
    format: z.string(),
    bucket: z.string(),
    key: z.string(),
    url: z.string(),
    expiresIn: z.number(),
    contentType: z.string().optional(),
    fileName: z.string().optional(),
  }),
});

type ExportRFPDocumentResponse = z.infer<typeof ExportRFPDocumentResponseSchema>;

// ─── Helpers ───

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

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

async function deleteJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

const BASE = `${env.BASE_API_URL}/rfp-document`;

// ─── Hooks ───

/** List RFP documents for a project, optionally filtered by opportunity */
export function useRFPDocuments(
  projectId: string | null,
  orgId: string | null,
  opportunityId?: string | null,
) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (orgId) params.set('orgId', orgId);
  if (opportunityId) params.set('opportunityId', opportunityId);

  const key =
    projectId && orgId
      ? `${BASE}/list?${params.toString()}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<RFPDocumentsListResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch RFP documents');
      return res.json();
    },
  );

  // Sort documents newest first by updatedAt
  const sortedDocuments = data?.items
    ? [...data.items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
    : [];

  return {
    documents: sortedDocuments,
    count: data?.count ?? 0,
    nextToken: data?.nextToken ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/** Create a new RFP document (returns presigned upload URL for file-based docs) */
export function useCreateRFPDocument(orgId?: string) {
  return useSWRMutation<CreateRFPDocumentResponse, Error, string, CreateRFPDocumentDTO>(
    `${BASE}/create${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<CreateRFPDocumentResponse>(url, arg),
  );
}

/** Update RFP document metadata and/or content */
export function useUpdateRFPDocument(orgId?: string) {
  return useSWRMutation<RFPDocumentResponse, Error, string, UpdateRFPDocumentDTO>(
    `${BASE}/update${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => patchJson<RFPDocumentResponse>(url, arg),
  );
}

/** Delete RFP document */
export function useDeleteRFPDocument(orgId?: string) {
  return useSWRMutation<
    { ok: boolean },
    Error,
    string,
    { projectId: string; opportunityId: string; documentId: string }
  >(
    `${BASE}/delete${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => deleteJson<{ ok: boolean }>(url, arg),
  );
}

/** Get preview URL for a document */
export function useDocumentPreviewUrl(orgId?: string) {
  return useSWRMutation<
    PresignedUrlResponse,
    Error,
    string,
    { projectId: string; opportunityId: string; documentId: string }
  >(
    `${BASE}/preview-url${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<PresignedUrlResponse>(url, arg),
  );
}

/** Get download URL for a document */
export function useDocumentDownloadUrl(orgId?: string) {
  return useSWRMutation<
    PresignedUrlResponse,
    Error,
    string,
    { projectId: string; opportunityId: string; documentId: string }
  >(
    `${BASE}/download-url${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<PresignedUrlResponse>(url, arg),
  );
}

/** Update signature status */
export function useUpdateSignatureStatus(orgId?: string) {
  return useSWRMutation<RFPDocumentResponse, Error, string, UpdateSignatureStatusDTO>(
    `${BASE}/update-signature${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<RFPDocumentResponse>(url, arg),
  );
}

/** Convert a file-based document to editable content */
export function useConvertToContent(orgId?: string) {
  return useSWRMutation<
    { ok: boolean; content: Record<string, any>; alreadyConverted: boolean },
    Error,
    string,
    { projectId: string; opportunityId: string; documentId: string }
  >(
    `${BASE}/convert-to-content${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson(url, arg),
  );
}

/** Sync an RFP document to Google Drive */
export function useSyncRFPDocumentToGoogleDrive(orgId?: string) {
  return useSWRMutation<
    { message: string; googleDriveFileId: string; googleDriveUrl: string },
    Error,
    string,
    { projectId: string; opportunityId: string; documentId: string }
  >(
    `${BASE}/sync-to-google-drive${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson(url, arg),
  );
}

/** Sync an RFP document back from Google Drive into the app */
export function useSyncRFPDocumentFromGoogleDrive(orgId?: string) {
  return useSWRMutation<
    { message: string; documentId: string; isDocx: boolean; lastSyncedAt: string },
    Error,
    string,
    { projectId: string; opportunityId: string; documentId: string }
  >(
    `${BASE}/sync-from-google-drive${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson(url, arg),
  );
}

// ─── Generate Document ───

const GenerateRFPDocumentRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().optional(),
  documentType: z.string().optional(),
  templateId: z.string().optional(),
});

export type GenerateRFPDocumentRequest = z.infer<typeof GenerateRFPDocumentRequestSchema>;

const GenerateRFPDocumentResponseSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  documentId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  documentType: z.string(),
  message: z.string().optional(),
});

export type GenerateRFPDocumentResponse = z.infer<typeof GenerateRFPDocumentResponseSchema>;

/**
 * Trigger async document generation (POST /rfp-document/generate-document).
 * Returns 202 Accepted with a documentId to poll.
 */
export function useGenerateRFPDocument(orgId?: string) {
  return useSWRMutation<GenerateRFPDocumentResponse, Error, string, GenerateRFPDocumentRequest>(
    `${BASE}/generate-document${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<GenerateRFPDocumentResponse>(url, arg),
  );
}

/**
 * Poll a single RFP document by documentId until its status is no longer GENERATING.
 * Returns null while the document is still being generated or not yet fetched.
 */
export function useRFPDocumentPolling(
  projectId: string | null,
  opportunityId: string | null,
  documentId: string | null,
  orgId: string | null,
) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (opportunityId) params.set('opportunityId', opportunityId);
  if (documentId) params.set('documentId', documentId);
  if (orgId) params.set('orgId', orgId);

  const shouldPoll = !!(projectId && opportunityId && documentId && orgId);

  const { data, error, isLoading } = useSWR<RFPDocumentResponse>(
    shouldPoll ? `${BASE}/get?${params.toString()}` : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch RFP document');
      return res.json();
    },
    {
      refreshInterval: (latestData) => {
        if (!latestData) return 3000;
        const status = latestData.document?.status;
        return status === 'GENERATING' ? 3000 : 0;
      },
      revalidateOnFocus: false,
    },
  );

  const document = data?.document ?? null;
  const isGenerating = !document || document.status === 'GENERATING';

  return {
    document,
    isGenerating,
    isLoading,
    isError: !!error,
    error,
  };
}

/** Export an RFP document (content-based documents only) */
export function useExportRFPDocument(orgId?: string) {
  return useSWRMutation<ExportRFPDocumentResponse, Error, string, ExportRFPDocumentRequest>(
    `${BASE}/export${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<ExportRFPDocumentResponse>(url, arg),
  );
}

// ─── HTML Content ───

const HtmlContentResponseSchema = z.object({
  ok: z.boolean(),
  html: z.string(),
  htmlContentKey: z.string().nullable(),
  documentId: z.string(),
});

type HtmlContentResponse = z.infer<typeof HtmlContentResponseSchema>;

/**
 * Fetch the HTML content for a content-based RFP document.
 * Loads from S3 via the backend (htmlContentKey) with fallback to inline DynamoDB content.
 */
export function useRFPDocumentHtmlContent(
  projectId: string | null,
  opportunityId: string | null,
  documentId: string | null,
  orgId: string | null,
) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (opportunityId) params.set('opportunityId', opportunityId);
  if (documentId) params.set('documentId', documentId);
  if (orgId) params.set('orgId', orgId);

  const key =
    projectId && opportunityId && documentId && orgId
      ? `${BASE}/html-content?${params.toString()}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<HtmlContentResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch HTML content');
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  return {
    html: data?.html ?? '',
    htmlContentKey: data?.htmlContentKey ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/** Upload file to S3 using presigned URL */
export async function uploadFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}