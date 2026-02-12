'use client';

import useSWRMutation from 'swr/mutation';

import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { breadcrumbs } from '@/lib/sentry';

import {
  type ProposalDocument,
  ProposalDocumentSchema,
} from '@auto-rfp/shared';

const BASE = `${env.BASE_API_URL}/rfp-document`;

interface GenerateDocumentInput {
  projectId: string;
  documentType?: string;
  templateId?: string;
}

/**
 * Hook to generate an RFP document using AI.
 * Supports any document type. Uses templates when available.
 * The generated ProposalDocument can then be saved as an RFP document.
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
