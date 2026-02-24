'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { GenerateReport, GenerateReportResponse } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/audit`;

export const useAuditReport = () => {
  return useSWRMutation(
    `${BASE}/report`,
    async (url: string, { arg }: { arg: GenerateReport }): Promise<GenerateReportResponse | string> => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });
      if (!res.ok) throw new Error('Failed to generate report');
      if (arg.format === 'csv') {
        // Return raw CSV text for download
        return res.text();
      }
      return res.json() as Promise<GenerateReportResponse>;
    },
  );
};
