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

  const emitEvent = async (orgId: string, projectId: string, oppId: string, force = false): Promise<EmitResult> => {
    setIsEmitting(true);
    try {
      const url = buildApiUrl('/opportunity/emit-event');
      return await apiMutate<EmitResult>(url, 'POST', { orgId, projectId, oppId, force });
    } finally {
      setIsEmitting(false);
    }
  };

  return { emitEvent, isEmitting };
};
