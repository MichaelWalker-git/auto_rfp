'use client';

import useSWRMutation from 'swr/mutation';
import { z } from 'zod';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

// ─── Request/Response Schemas ───

const ExportAllRequiredFormsRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  mode: z.enum(['individual', 'merged']).optional(),
  documentIds: z.array(z.string()).optional(),
  format: z.literal('pdf').optional(),
  fileName: z.string().optional(),
  options: z.object({
    pageSize: z.enum(['letter', 'a4']).optional(),
    pageBreakBetween: z.boolean().optional(),
  }).optional(),
});

export type ExportAllRequiredFormsRequest = z.infer<typeof ExportAllRequiredFormsRequestSchema>;

const ExportedFormInfoSchema = z.object({
  formId: z.string(),
  name: z.string(),
  formats: z.array(z.string()),
  skipped: z.boolean(),
  skipReason: z.string().optional(),
});

const ExportAllRequiredFormsResponseSchema = z.object({
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
    totalForms: z.number(),
    exportedForms: z.number(),
    skippedForms: z.number(),
    formats: z.array(z.string()),
  }),
  forms: z.array(ExportedFormInfoSchema),
});

export type ExportAllRequiredFormsResponse = z.infer<typeof ExportAllRequiredFormsResponseSchema>;

// Merged export response
const ExportMergedRequiredFormsResponseSchema = z.object({
  success: z.boolean(),
  fileName: z.string(),
  url: z.string(),
  documentCount: z.number(),
  format: z.string(),
});

export type ExportMergedRequiredFormsResponse = z.infer<typeof ExportMergedRequiredFormsResponseSchema>;

// ─── API Helpers ───

class ApiError extends Error {
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
  return res.json();
};

const BASE = `${env.BASE_API_URL}/required-forms`;

// ─── Hooks ───

/** Export all required forms as individual PDFs in a ZIP bundle */
export const useExportAllRequiredForms = (orgId?: string) => {
  return useSWRMutation<ExportAllRequiredFormsResponse, Error, string, ExportAllRequiredFormsRequest>(
    `${BASE}/export-all${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<ExportAllRequiredFormsResponse>(url, arg),
  );
};

/** Export selected required forms merged into one package */
export const useExportMergedRequiredForms = (orgId?: string) => {
  return useSWRMutation<ExportMergedRequiredFormsResponse, Error, string, ExportAllRequiredFormsRequest>(
    `${BASE}/export-all${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<ExportMergedRequiredFormsResponse>(url, { ...arg, mode: 'merged' }),
  );
};
