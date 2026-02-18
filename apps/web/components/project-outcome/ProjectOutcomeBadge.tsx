'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Trophy, XCircle, Clock, Ban, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectOutcomeStatus } from '@auto-rfp/core';

interface ProjectOutcomeBadgeProps {
  status: ProjectOutcomeStatus | undefined | null;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

const statusConfig: Record<
  ProjectOutcomeStatus,
  { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline'; icon: React.ElementType }
> = {
  WON: { label: 'Won', variant: 'default', icon: Trophy },
  LOST: { label: 'Lost', variant: 'destructive', icon: XCircle },
  PENDING: { label: 'Pending', variant: 'secondary', icon: Clock },
  NO_BID: { label: 'No Bid', variant: 'outline', icon: Ban },
  WITHDRAWN: { label: 'Withdrawn', variant: 'outline', icon: LogOut },
};

export function ProjectOutcomeBadge({
  status,
  size = 'md',
  showIcon = true,
  className,
}: ProjectOutcomeBadgeProps) {
  const config = status ? statusConfig[status] : statusConfig.PENDING;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-0.5',
    lg: 'text-base px-3 py-1',
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  return (
    <Badge
      variant={config.variant}
      className={cn(
        'gap-1.5 font-medium',
        sizeClasses[size],
        status === 'WON' && 'bg-green-600 hover:bg-green-700',
        className
      )}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {config.label}
    </Badge>
  );
}
