'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/api';

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
      const res = await apiMutate('/opportunity/emit-event', {
        method: 'POST',
        body: { orgId, projectId, oppId, force },
      });
      return res as EmitResult;
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