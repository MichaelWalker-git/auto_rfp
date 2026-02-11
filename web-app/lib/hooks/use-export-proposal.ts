'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

export type ExportFormat = 'docx' | 'pdf' | 'html' | 'txt' | 'pptx' | 'md' | 'batch';

interface ExportProposalRequest {
  projectId: string;
  proposalId: string;
  opportunityId: string;
  format?: ExportFormat;
  options?: {
    pageSize?: 'letter' | 'a4';
    includeTableOfContents?: boolean;
    includeCitations?: boolean;
    pageLimitsPerSection?: number;
  };
  formats?: ExportFormat[]; // for batch export
}

interface ExportProposalResponse {
  success: boolean;
  proposal: {
    id: string;
    title: string;
  };
  export: {
    format: string;
    bucket: string;
    key: string;
    url: string;
    expiresIn: number;
    contentType?: string;
    fileName?: string;
    includedFormats?: string[];
  };
}

const BASE = `${env.BASE_API_URL}/export`;

const FORMAT_ENDPOINTS: Record<ExportFormat, string> = {
  docx: 'generate-word',
  pdf: 'generate-pdf',
  html: 'generate-html',
  txt: 'generate-txt',
  pptx: 'generate-pptx',
  md: 'generate-md',
  batch: 'generate-batch',
};

const FORMAT_LABELS: Record<ExportFormat, string> = {
  docx: 'Word Document (.docx)',
  pdf: 'PDF Document (.pdf)',
  html: 'HTML (.html)',
  txt: 'Plain Text (.txt)',
  pptx: 'PowerPoint (.pptx)',
  md: 'Markdown (.md)',
  batch: 'All Formats (.zip)',
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  docx: '.docx',
  pdf: '.pdf',
  html: '.html',
  txt: '.txt',
  pptx: '.pptx',
  md: '.md',
  batch: '.zip',
};

export { FORMAT_LABELS, FORMAT_EXTENSIONS };

export function useExportProposal() {
  return useSWRMutation<ExportProposalResponse, any, string, ExportProposalRequest>(
    `${BASE}/generate-word`,
    async (_url, { arg }) => {
      const format = arg.format || 'docx';
      const endpoint = FORMAT_ENDPOINTS[format];
      const url = `${BASE}/${endpoint}`;

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to export proposal') as Error & {
          status?: number;
        };
        error.status = res.status;
        throw error;
      }

      const json = await res.json().catch(() => {
        throw new Error('Invalid JSON returned from API');
      });

      if (!json.success) {
        throw new Error(json.message || 'Failed to export proposal');
      }

      return json;
    },
  );
}