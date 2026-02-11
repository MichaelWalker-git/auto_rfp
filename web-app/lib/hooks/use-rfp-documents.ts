'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

// ─── Types ───

export const RFP_DOCUMENT_TYPES = {
  EXECUTIVE_BRIEF: 'Executive Brief',
  TECHNICAL_PROPOSAL: 'Technical Proposal',
  COST_PROPOSAL: 'Cost Proposal',
  PAST_PERFORMANCE: 'Past Performance',
  MANAGEMENT_APPROACH: 'Management Approach',
  COMPLIANCE_MATRIX: 'Compliance Matrix',
  TEAMING_AGREEMENT: 'Teaming Agreement',
  NDA: 'NDA',
  CONTRACT: 'Contract',
  AMENDMENT: 'Amendment',
  CORRESPONDENCE: 'Correspondence',
  OTHER: 'Other',
} as const;

export type RFPDocumentType = keyof typeof RFP_DOCUMENT_TYPES;

export const SIGNATURE_STATUSES = {
  NOT_REQUIRED: 'Not Required',
  PENDING_SIGNATURE: 'Pending Signature',
  PARTIALLY_SIGNED: 'Partially Signed',
  FULLY_SIGNED: 'Fully Signed',
  REJECTED: 'Rejected',
} as const;

export type SignatureStatus = keyof typeof SIGNATURE_STATUSES;

export const LINEAR_SYNC_STATUSES = {
  NOT_SYNCED: 'Not Synced',
  SYNCED: 'Synced',
  SYNC_FAILED: 'Sync Failed',
} as const;

export type LinearSyncStatus = keyof typeof LINEAR_SYNC_STATUSES;

export interface Signer {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'PENDING' | 'SIGNED' | 'REJECTED';
  signedAt?: string | null;
  notes?: string | null;
}

export interface SignatureDetails {
  signers: Signer[];
  signatureMethod?: string | null;
  externalSignatureId?: string | null;
  driveFileId?: string | null;
  driveFileUrl?: string | null;
  lastCheckedAt?: string | null;
}

export interface RFPDocumentItem {
  documentId: string;
  projectId: string;
  opportunityId: string;
  orgId: string;
  name: string;
  description?: string | null;
  documentType: RFPDocumentType;
  mimeType: string;
  fileSizeBytes: number;
  originalFileName?: string | null;
  fileKey: string;
  version: number;
  previousVersionId?: string | null;
  signatureStatus: SignatureStatus;
  signatureDetails?: SignatureDetails | null;
  linearSyncStatus: LinearSyncStatus;
  linearCommentId?: string | null;
  lastSyncedAt?: string | null;
  deletedAt?: string | null;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRFPDocumentDTO {
  projectId: string;
  opportunityId: string;
  name: string;
  description?: string | null;
  documentType: RFPDocumentType;
  mimeType: string;
  fileSizeBytes: number;
  originalFileName?: string | null;
}

export interface UpdateRFPDocumentDTO {
  projectId: string;
  opportunityId: string;
  documentId: string;
  name?: string;
  description?: string | null;
  documentType?: RFPDocumentType;
}

export interface UpdateSignatureStatusDTO {
  projectId: string;
  opportunityId: string;
  documentId: string;
  signatureStatus: SignatureStatus;
  signatureDetails?: SignatureDetails | null;
}

interface RFPDocumentsListResponse {
  ok: boolean;
  items: RFPDocumentItem[];
  nextToken: string | null;
  count: number;
}

interface CreateRFPDocumentResponse {
  ok: boolean;
  document: RFPDocumentItem;
  upload: {
    url: string;
    method: string;
    bucket: string;
    key: string;
    expiresIn: number;
  };
}

interface RFPDocumentResponse {
  ok: boolean;
  document: RFPDocumentItem;
}

interface PresignedUrlResponse {
  ok: boolean;
  url: string;
  mimeType: string;
  fileName: string;
  expiresIn: number;
}

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

/** List all RFP documents for a project */
export function useRFPDocuments(
  projectId: string | null,
  orgId: string | null,
) {
  const key =
    projectId && orgId
      ? `${BASE}/list?projectId=${projectId}&orgId=${orgId}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<RFPDocumentsListResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch RFP documents');
      return res.json();
    },
  );

  return {
    documents: data?.items ?? [],
    count: data?.count ?? 0,
    nextToken: data?.nextToken ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/** Create a new RFP document (returns presigned upload URL) */
export function useCreateRFPDocument(orgId?: string) {
  return useSWRMutation<CreateRFPDocumentResponse, Error, string, CreateRFPDocumentDTO>(
    `${BASE}/create${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<CreateRFPDocumentResponse>(url, arg),
  );
}

/** Update RFP document metadata */
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