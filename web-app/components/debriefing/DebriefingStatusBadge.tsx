'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckCircle2, Clock, MessageSquare, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DebriefingStatus } from '@auto-rfp/shared';

interface DebriefingStatusBadgeProps {
  status: DebriefingStatus;
  className?: string;
}

const statusConfig: Record<
  DebriefingStatus,
  { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline'; icon: React.ElementType }
> = {
  NOT_REQUESTED: { label: 'Not Requested', variant: 'outline', icon: Clock },
  REQUESTED: { label: 'Requested', variant: 'secondary', icon: MessageSquare },
  SCHEDULED: { label: 'Scheduled', variant: 'default', icon: Calendar },
  COMPLETED: { label: 'Completed', variant: 'default', icon: CheckCircle2 },
  DECLINED: { label: 'Declined', variant: 'destructive', icon: XCircle },
};

export function DebriefingStatusBadge({ status, className }: DebriefingStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn(
        'gap-1.5 font-medium',
        status === 'COMPLETED' && 'bg-green-600 hover:bg-green-700',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
