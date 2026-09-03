'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  RFPDocumentItem,
  RFPDocumentType,
  RFPDocumentContent,
  EditHistoryEntry,
  CreateRFPDocumentDTO,
  UpdateRFPDocumentDTO,
  RFPExportFormat,
  LinearSyncStatus,
  CustomDocumentType,
  KBCoverageMissingCategory,
} from '@auto-rfp/core';
import {
  RFP_DOCUMENT_TYPES,
  RFP_DOCUMENT_TYPE_DESCRIPTIONS,
  LINEAR_SYNC_STATUSES,
  RFP_EXPORT_FORMAT_LABELS,
  RFP_EXPORT_FORMAT_EXTENSIONS,
  KBCoverageIncompleteBodySchema,
  buildKBCoverageIncompleteMessage,
} from '@auto-rfp/core';

// Re-export types and constants from shared for convenience
export type { RFPDocumentItem, RFPDocumentType, EditHistoryEntry, LinearSyncStatus };
export type { CreateRFPDocumentDTO, UpdateRFPDocumentDTO };
export type { RFPExportFormat as ExportFormat };
export { RFP_DOCUMENT_TYPES, RFP_DOCUMENT_TYPE_DESCRIPTIONS, LINEAR_SYNC_STATUSES };
export { RFP_EXPORT_FORMAT_LABELS as EXPORT_FORMAT_LABELS, RFP_EXPORT_FORMAT_EXTENSIONS as EXPORT_FORMAT_EXTENSIONS };

import { z } from 'zod';
import {
  RFPDocumentItemSchema,
  RFPExportFormatSchema,
  SolutionPlanStatusSchema,
  type SolutionPlanStatus,
} from '@auto-rfp/core';

// ─── Zod-defined response/request schemas ───

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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new ApiError(raw || 'Request failed', res.status);
  }
  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return { ok: true } as T;
  }
};

const patchJson = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new ApiError(raw || 'Request failed', res.status);
  }
  return res.json();
};

const deleteJson = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new ApiError(raw || 'Request failed', res.status);
  }
  return res.json();
};

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
    {
      // Auto-poll every 5s when any document is GENERATING or RETRYING
      refreshInterval: (latestData) => {
        const hasInProgress = latestData?.items?.some(
          (doc) => doc.status === 'GENERATING' || doc.status === 'RETRYING',
        );
        return hasInProgress ? 5000 : 0;
      },
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

/** Convert a file-based document to editable content */
export function useConvertToContent(orgId?: string) {
  return useSWRMutation<
    { ok: boolean; content: RFPDocumentContent | null; htmlContentKey: string | null; alreadyConverted: boolean },
    Error,
    string,
    { projectId: string; opportunityId: string; documentId: string }
  >(
    `${BASE}/convert-to-content${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson(url, arg),
  );
}

/**
 * Response of a pull from Google Drive.
 *
 * `changed` is the field to branch on: a pull whose Drive `modifiedTime` has not moved
 * past the recorded watermark performs zero writes and returns `changed: false`, which
 * is a success, not a no-op error. `versionNumber` is present only when an HTML version
 * snapshot was created.
 */
export interface SyncFromGoogleDriveResponse {
  message: string;
  documentId: string;
  changed: boolean;
  versionNumber?: number;
  driveModifiedTime?: string;
  driveLastPulledAt?: string;
  /** True when an approved document was imported under an explicit override. */
  overrodeApproval?: boolean;
  /** True when the import landed on a document with an open review and reviewers were told. */
  notifiedPendingReviewers?: boolean;
  syncStatus: string;
}

/** Sync an RFP document back from Google Drive into the app */
export function useSyncRFPDocumentFromGoogleDrive(orgId?: string) {
  return useSWRMutation<
    SyncFromGoogleDriveResponse,
    Error,
    string,
    {
      projectId: string;
      opportunityId: string;
      documentId: string;
      /** Import into an approved document anyway, reopening its approval. */
      acceptApprovedOverride?: boolean;
    }
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
  /** If provided, regenerate content into this existing document instead of creating a new one */
  documentId: z.string().optional(),
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
 * 409 from generate-document when the org requires a READY Solution Plan
 * before generating gated document types (T9/T12). Components branch on this
 * via `isSolutionPlanRequiredError` to show a specific toast.
 */
export class SolutionPlanRequiredError extends ApiError {
  code = 'SOLUTION_PLAN_REQUIRED' as const;
  solutionPlanStatus: SolutionPlanStatus | null;

  constructor(message: string, solutionPlanStatus: SolutionPlanStatus | null = null) {
    super(message, 409);
    this.name = 'SolutionPlanRequiredError';
    this.solutionPlanStatus = solutionPlanStatus;
  }
}

export const isSolutionPlanRequiredError = (err: unknown): err is SolutionPlanRequiredError =>
  err instanceof SolutionPlanRequiredError;

/**
 * 409 from generate-document when the knowledge base doesn't hold the inputs the
 * document type requires. Carries the named gaps so the toast prints the same
 * list the dialog badge showed.
 */
export class KBCoverageIncompleteError extends ApiError {
  code = 'KB_COVERAGE_INCOMPLETE' as const;
  missingCategories: KBCoverageMissingCategory[];

  constructor(message: string, missingCategories: KBCoverageMissingCategory[] = []) {
    super(message, 409);
    this.name = 'KBCoverageIncompleteError';
    this.missingCategories = missingCategories;
  }
}

export const isKBCoverageIncompleteError = (err: unknown): err is KBCoverageIncompleteError =>
  err instanceof KBCoverageIncompleteError;

const SOLUTION_PLAN_REQUIRED_MESSAGE =
  'A ready Solution Plan is required before generating this document. Create one from the Solution Plan section of the opportunity page.';

/**
 * 409 body produced by the server gate (T9). An unrecognized
 * `solutionPlanStatus` degrades to null rather than failing the whole parse.
 */
const SolutionPlanRequiredBodySchema = z.object({
  code: z.literal('SOLUTION_PLAN_REQUIRED'),
  message: z.string().optional(),
  solutionPlanStatus: SolutionPlanStatusSchema.nullable().catch(null).optional(),
});

/**
 * Map a raw generate-document failure to the typed error matching the 409's
 * machine-readable `code` — one gate, two precondition types, one refusal
 * model. All other errors pass through unchanged. Exported for tests.
 */
export const toGenerateDocumentError = (err: unknown): unknown => {
  if (!(err instanceof ApiError) || err.status !== 409) return err;
  let raw: unknown;
  try {
    raw = JSON.parse(err.message);
  } catch {
    return err; // Not a JSON body
  }

  const coverage = KBCoverageIncompleteBodySchema.safeParse(raw);
  if (coverage.success) {
    return new KBCoverageIncompleteError(
      coverage.data.message || buildKBCoverageIncompleteMessage(coverage.data.missingCategories),
      coverage.data.missingCategories,
    );
  }

  const { success, data: body } = SolutionPlanRequiredBodySchema.safeParse(raw);
  if (!success) return err;
  return new SolutionPlanRequiredError(
    body.message || SOLUTION_PLAN_REQUIRED_MESSAGE,
    body.solutionPlanStatus ?? null,
  );
};

/**
 * Trigger async document generation (POST /rfp-document/generate-document).
 * Returns 202 Accepted with a documentId to poll. A 409 SOLUTION_PLAN_REQUIRED
 * rejection surfaces as `SolutionPlanRequiredError` (defense-in-depth behind
 * the client-side gate in `@/features/solution-plan`).
 */
export function useGenerateRFPDocument(orgId?: string) {
  return useSWRMutation<GenerateRFPDocumentResponse, Error, string, GenerateRFPDocumentRequest>(
    `${BASE}/generate-document${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) =>
      postJson<GenerateRFPDocumentResponse>(url, arg).catch((err: unknown) => {
        throw toGenerateDocumentError(err);
      }),
  );
}

/**
 * Poll a single RFP document by documentId until its status is no longer GENERATING or RETRYING.
 * Returns null while the document is still being generated/retrying or not yet fetched.
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

  const { data, error, isLoading, mutate } = useSWR<RFPDocumentResponse>(
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
        // Continue polling while GENERATING or RETRYING
        return status === 'GENERATING' || status === 'RETRYING' ? 3000 : 0;
      },
      revalidateOnFocus: false,
    },
  );

  const document = data?.document ?? null;
  // isGenerating is true while GENERATING or RETRYING (both are in-progress states)
  const isGenerating = !document || document.status === 'GENERATING' || document.status === 'RETRYING';

  return {
    document,
    isGenerating,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/** Export an RFP document (content-based documents only) */
export function useExportRFPDocument(orgId?: string) {
  return useSWRMutation<ExportRFPDocumentResponse, Error, string, ExportRFPDocumentRequest>(
    `${BASE}/export${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<ExportRFPDocumentResponse>(url, arg),
  );
}

// ─── Export All Documents ───

const ExportAllRFPDocumentsRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().optional(),
  formats: z.array(z.enum(['docx', 'pdf', 'pptx', 'html', 'txt', 'md'])).optional(),
  options: z.object({
    pageSize: z.enum(['letter', 'a4']).optional(),
    includeQuestionnaires: z.boolean().optional(),
    includeRequiredForms: z.boolean().optional(),
  }).optional(),
});

export type ExportAllRFPDocumentsRequest = z.infer<typeof ExportAllRFPDocumentsRequestSchema>;

const ExportedDocInfoSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  formats: z.array(z.string()),
  skipped: z.boolean(),
  skipReason: z.string().optional(),
});

const ExportAllRFPDocumentsResponseSchema = z.object({
  success: z.boolean(),
  export: z.object({
    url: z.string(),
    fileName: z.string(),
    bucket: z.string(),
    key: z.string(),
    expiresIn: z.number(),
    contentType: z.string(),
    sizeBytes: z.number(),
  }),
  summary: z.object({
    totalDocuments: z.number(),
    exportedDocuments: z.number(),
    skippedDocuments: z.number(),
    formats: z.array(z.string()),
    questionnaireCount: z.number().optional(),
    requiredFormsCount: z.number().optional(),
  }),
  documents: z.array(ExportedDocInfoSchema),
});

export type ExportAllRFPDocumentsResponse = z.infer<typeof ExportAllRFPDocumentsResponseSchema>;

/** Export all RFP documents as a ZIP bundle (DOCX + PDF for each) */
export function useExportAllRFPDocuments(orgId?: string) {
  return useSWRMutation<ExportAllRFPDocumentsResponse, Error, string, ExportAllRFPDocumentsRequest>(
    `${BASE}/export-all${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<ExportAllRFPDocumentsResponse>(url, arg),
  );
}

// ─── Export Merged ───

export type ExportMergedRequest = {
  projectId: string;
  opportunityId: string;
  documentIds: string[];
  format: 'docx' | 'pdf';
  fileName?: string;
  options?: {
    pageSize?: 'letter' | 'a4';
    pageBreakBetween?: boolean;
  };
};

export type ExportMergedResponse = {
  success: boolean;
  fileName: string;
  url: string;
  documentCount: number;
  format: string;
};

export function useExportMergedRFPDocuments(orgId?: string) {
  return useSWRMutation<ExportMergedResponse, Error, string, ExportMergedRequest>(
    `${BASE}/export-all${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<ExportMergedResponse>(url, { ...arg, mode: 'merged' }),
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

// ─── Custom Document Types ───

export type { CustomDocumentType };

/**
 * Fetch org-specific custom document types discovered by AI.
 * Returns both built-in types (from RFP_DOCUMENT_TYPES) and custom types merged together.
 */
export function useCustomDocumentTypes(orgId: string | null) {
  const key = orgId ? `${BASE}/custom-document-types?orgId=${orgId}` : null;

  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; items: CustomDocumentType[]; count: number }>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch custom document types');
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  return {
    customTypes: data?.items ?? [],
    isLoading,
    isError: !!error,
    mutate,
  };
}

/** Save a new custom document type manually */
export function useSaveCustomDocumentType(orgId: string | null) {
  return useSWRMutation<
    { ok: boolean; item: CustomDocumentType },
    Error,
    string,
    { name: string; description?: string | null }
  >(
    orgId ? `${BASE}/custom-document-types?orgId=${orgId}` : 'noop',
    (url, { arg }) => postJson(url, arg),
  );
}

// ─── Edit Section (AI Chat) ───

const EditSectionRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
  sectionTitle: z.string().min(1),
  currentSectionHtml: z.string(),
  instruction: z.string().min(1).max(2000),
  fullDocumentContext: z.string().optional(),
});

export type EditSectionRequest = z.infer<typeof EditSectionRequestSchema>;

const EditSectionResponseSchema = z.object({
  ok: z.boolean(),
  sectionTitle: z.string(),
  /** Updated HTML — absent when the AI returns a message instead of an edit */
  updatedHtml: z.string().optional(),
  /** Conversational message from AI (e.g. asking for clarification) */
  message: z.string().optional(),
  toolRoundsUsed: z.number(),
});

export type EditSectionResponse = z.infer<typeof EditSectionResponseSchema>;

/**
 * AI-powered section editing with extended timeout.
 * Large questionnaires can take up to 180s to process on the backend.
 */
const postJsonWithTimeout = async <T>(url: string, body: unknown, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new ApiError(raw || 'Request failed', res.status);
    }
    const raw = await res.text().catch(() => '');
    if (!raw) return { ok: true } as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return { ok: true } as T;
    }
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * AI-powered section editing. Sends a section's HTML and user instructions
 * to the AI, which returns updated section HTML.
 */
export function useEditSection(orgId?: string) {
  return useSWRMutation<EditSectionResponse, Error, string, EditSectionRequest>(
    `${BASE}/edit-section${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJsonWithTimeout<EditSectionResponse>(url, arg, 200_000), // 200s timeout (exceeds backend 180s)
  );
}

// ─── Chat Messages (Persisted History) ───

const ChatMessageSchema = z.object({
  messageId: z.string(),
  documentId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  orgId: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  sectionTitle: z.string(),
  applied: z.boolean().optional(),
  error: z.string().optional(),
  toolRoundsUsed: z.number().optional(),
  userId: z.string().optional(),
  timestamp: z.string(),
  createdAt: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

const ChatMessagesResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(ChatMessageSchema),
  count: z.number(),
});

type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>;

/**
 * Fetch persisted AI chat messages for a document.
 * Returns messages ordered by timestamp ascending (oldest first).
 */
export function useChatMessages(
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
      ? `${BASE}/chat-messages?${params.toString()}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<ChatMessagesResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch chat messages');
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  return {
    messages: data?.items ?? [],
    count: data?.count ?? 0,
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