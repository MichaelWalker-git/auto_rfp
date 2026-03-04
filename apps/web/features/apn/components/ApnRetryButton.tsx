'use client';

import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useRetryApnRegistration } from '../hooks/useRetryApnRegistration';
import type { ApnRegistrationItem } from '@auto-rfp/core';

interface ApnRetryButtonProps {
  registration: ApnRegistrationItem;
  onSuccess?: () => void;
}

export const ApnRetryButton = ({ registration, onSuccess }: ApnRetryButtonProps) => {
  const { retry, isLoading, error } = useRetryApnRegistration();

  if (registration.status !== 'FAILED') return null;

  const handleRetry = async () => {
    const ok = await retry({
      orgId:          registration.orgId,
      projectId:      registration.projectId,
      oppId:          registration.oppId,
      registrationId: registration.registrationId,
    });
    if (ok) onSuccess?.();
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
        disabled={isLoading}
        className="h-7 text-xs gap-1.5"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Retrying…
          </>
        ) : (
          <>
            <RefreshCw className="h-3 w-3" />
            Retry
          </>
        )}
      </Button>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
};
