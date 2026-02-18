'use client';

import useSWRMutation from 'swr/mutation';

import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { readStoredOrgId } from '@/lib/org-selection';
import { breadcrumbs } from '@/lib/sentry';

import {
  type ProposalDocument,
  ProposalDocumentSchema,
} from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/rfp-document`;

interface GenerateDocumentInput {
  projectId: string;
  opportunityId?: string;
  documentType?: string;
  templateId?: string;
}

interface AsyncGenerateResponse {
  ok: boolean;
  status: string;
  documentId: string;
  projectId: string;
  opportunityId: string;
  documentType: string;
  message: string;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutes max

async function pollForCompletion(
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<ProposalDocument> {
  const orgId = readStoredOrgId();
  const params = new URLSearchParams({
    projectId,
    opportunityId,
    documentId,
    ...(orgId ? { orgId } : {}),
  });
  const url = `${BASE}/get?${params.toString()}`;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const res = await authFetcher(url);
    if (!res.ok) {
      throw new Error('Failed to check document generation status');
    }

    const json = await res.json();
    // The get-rfp-document API wraps the document in { ok, document: { ... } }
    const doc = json.document || json;

    if (doc.status === 'COMPLETE' && doc.content) {
      const parsed = ProposalDocumentSchema.safeParse(doc.content);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`Generated document has invalid format: ${issues}`);
      }
      return parsed.data;
    }

    if (doc.status === 'FAILED') {
      throw new Error(doc.generationError || 'Document generation failed');
    }

    // Still GENERATING — continue polling
  }

  throw new Error('Document generation timed out. Please try again.');
}

/**
 * Hook to generate an RFP document using AI.
 * Supports both:
 * - Async mode (new backend): Returns 202 with documentId, then polls for completion
 * - Sync mode (old backend): Returns 200 with the full ProposalDocument directly
 */
export function useGenerateProposal() {
  return useSWRMutation<ProposalDocument, any, string, GenerateDocumentInput>(
    `${BASE}/generate-document`,
    async (url, { arg }) => {
      if (!arg.projectId) throw new Error('projectId is required');

      breadcrumbs.proposalGenerationStarted(arg.projectId);

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({
          projectId: arg.projectId,
          opportunityId: arg.opportunityId,
          documentType: arg.documentType || 'TECHNICAL_PROPOSAL',
          templateId: arg.templateId,
        }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to generate document') as Error & {
          status?: number;
        };
        error.status = res.status;
        throw error;
      }

      const json = await res.json().catch(() => {
        throw new Error('Invalid JSON returned from API');
      });

      // Async mode: API returned 202 with documentId — poll for completion
      if (json.status === 'GENERATING' && json.documentId) {
        const asyncResponse = json as AsyncGenerateResponse;
        const document = await pollForCompletion(
          asyncResponse.projectId,
          asyncResponse.opportunityId,
          asyncResponse.documentId,
        );
        breadcrumbs.proposalGenerationCompleted(arg.projectId);
        return document;
      }

      // Sync mode (legacy): API returned the full ProposalDocument directly
      const parsed = ProposalDocumentSchema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`API returned invalid document: ${issues}`);
      }

      breadcrumbs.proposalGenerationCompleted(arg.projectId);
      return parsed.data;
    },
  );
}
