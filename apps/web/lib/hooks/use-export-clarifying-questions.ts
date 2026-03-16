'use client';

import { useState } from 'react';
import { apiMutate, buildApiUrl } from './api-helpers';
import type { ClarifyingQuestionsExportOptions } from '@auto-rfp/core';

interface ExportResult {
  documentId: string;
  status: string;
}

/**
 * Hook for exporting clarifying questions as a formatted document.
 * Creates an RFP document of type CLARIFYING_QUESTIONS.
 */
export const useExportClarifyingQuestions = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportQuestions = async (
    orgId: string,
    projectId: string,
    opportunityId: string,
    options?: Partial<ClarifyingQuestionsExportOptions>,
    templateId?: string,
  ): Promise<ExportResult | null> => {
    setIsExporting(true);
    setError(null);

    try {
      const result = await apiMutate<ExportResult>(
        buildApiUrl('rfp-document/generate-document', { orgId }),
        'POST',
        {
          projectId,
          opportunityId,
          documentType: 'CLARIFYING_QUESTIONS',
          templateId,
          options,
        },
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export questions';
      setError(message);
      return null;
    } finally {
      setIsExporting(false);
    }
  };

  return { exportQuestions, isExporting, error };
};
