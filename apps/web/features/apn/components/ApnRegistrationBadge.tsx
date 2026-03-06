'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink } from 'lucide-react';
import type { ApnRegistrationStatus } from '@auto-rfp/core';

interface ApnRegistrationBadgeProps {
  status: ApnRegistrationStatus | null | undefined;
  isLoading?: boolean;
  apnOpportunityUrl?: string;
}

const STATUS_CONFIG: Record<
  ApnRegistrationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  PENDING:        { label: 'APN: Pending',        variant: 'secondary' },
  REGISTERED:     { label: 'APN: Registered',     variant: 'default' },
  FAILED:         { label: 'APN: Failed',         variant: 'destructive' },
  RETRYING:       { label: 'APN: Retrying…',      variant: 'secondary' },
  NOT_CONFIGURED: { label: 'APN: Not Configured', variant: 'outline' },
};

export const ApnRegistrationBadge = ({
  status,
  isLoading,
  apnOpportunityUrl,
}: ApnRegistrationBadgeProps) => {
  if (isLoading) {
    return <Skeleton className="h-5 w-32 rounded-full" />;
  }

  if (!status) return null;

  const config = STATUS_CONFIG[status];

  if (status === 'REGISTERED' && apnOpportunityUrl) {
    return (
      <a
        href={apnOpportunityUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
      >
        <Badge variant={config.variant} className="gap-1">
          {config.label}
          <ExternalLink className="h-3 w-3" />
        </Badge>
      </a>
    );
  }

  return <Badge variant={config.variant}>{config.label}</Badge>;
};
