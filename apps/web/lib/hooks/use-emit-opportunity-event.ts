'use client';

import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';

interface EmitResult {
  message: string;
  emittedAt: string;
  attachmentCount: number;
}

export const useEmitOpportunityEvent = () => {
  const [isEmitting, setIsEmitting] = useState(false);
  const [emitError, setEmitError] = useState<string | null>(null);

  const emitEvent = async (orgId: string, projectId: string, oppId: string, force = false): Promise<EmitResult | null> => {
    setIsEmitting(true);
    setEmitError(null);
    try {
      const url = buildApiUrl('/opportunity/emit-event');
      const res = await apiMutate<EmitResult>(url, 'POST', { orgId, projectId, oppId, force });
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to emit event';
      setEmitError(msg);
      return null;
    } finally {
      setIsEmitting(false);
    }
  };

  return { emitEvent, isEmitting, emitError, setEmitError };
};