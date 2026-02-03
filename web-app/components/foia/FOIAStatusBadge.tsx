'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { FOIAStatus } from '@auto-rfp/shared';

interface FOIAStatusBadgeProps {
  status: FOIAStatus;
  className?: string;
}

const STATUS_CONFIG: Record<FOIAStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  READY_TO_SUBMIT: { label: 'Ready to Submit', variant: 'secondary' },
  SUBMITTED: { label: 'Submitted', variant: 'default' },
  ACKNOWLEDGED: { label: 'Acknowledged', variant: 'default' },
  IN_PROCESSING: { label: 'In Processing', variant: 'default' },
  RESPONSE_RECEIVED: { label: 'Response Received', variant: 'default' },
  APPEAL_FILED: { label: 'Appeal Filed', variant: 'destructive' },
  CLOSED: { label: 'Closed', variant: 'secondary' },
};

export function FOIAStatusBadge({ status, className }: FOIAStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || { label: status, variant: 'outline' as const };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
