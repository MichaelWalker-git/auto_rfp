'use client';

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CircleCheck, AlertTriangle, Ban, Archive } from 'lucide-react';
import type { FreshnessStatus, StaleReason } from '@auto-rfp/core';

interface FreshnessStatusBadgeProps {
  status?: FreshnessStatus | null;
  reason?: StaleReason | null;
  staleSince?: string | null;
  compact?: boolean;
}

const STATUS_CONFIG = {
  ACTIVE: {
    label: 'Active',
    icon: CircleCheck,
    variant: 'default' as const,
    className: 'bg-green-100 text-green-800 hover:bg-green-100 border-green-200',
    description: 'Current and safe to use',
  },
  WARNING: {
    label: 'Warning',
    icon: AlertTriangle,
    variant: 'default' as const,
    className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200',
    description: 'Review recommended',
  },
  STALE: {
    label: 'Stale',
    icon: Ban,
    variant: 'destructive' as const,
    className: 'bg-red-100 text-red-800 hover:bg-red-100 border-red-200',
    description: 'Do not use — outdated content',
  },
  ARCHIVED: {
    label: 'Archived',
    icon: Archive,
    variant: 'secondary' as const,
    className: 'bg-gray-100 text-gray-600 hover:bg-gray-100 border-gray-200',
    description: 'Permanently retired',
  },
} as const;

const REASON_LABELS: Record<string, string> = {
  NOT_USED: 'Not used in 180+ days',
  CERT_EXPIRED: 'Certification expired',
  SOURCE_UPDATED: 'Source document was updated',
  CONFLICTING_ANSWER: 'Conflicts with newer entry',
  MANUAL: 'Manually marked as stale',
};

export function FreshnessStatusBadge({
  status,
  reason,
  staleSince,
  compact = false,
}: FreshnessStatusBadgeProps) {
  const effectiveStatus = status ?? 'ACTIVE';
  const config = STATUS_CONFIG[effectiveStatus];
  const Icon = config.icon;

  const tooltipContent = [
    config.description,
    reason ? REASON_LABELS[reason] : null,
    staleSince ? `Since: ${new Date(staleSince).toLocaleDateString()}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Icon className={`h-4 w-4 ${
                effectiveStatus === 'ACTIVE' ? 'text-green-600' :
                effectiveStatus === 'WARNING' ? 'text-yellow-600' :
                effectiveStatus === 'STALE' ? 'text-red-600' :
                'text-gray-400'
              }`} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="whitespace-pre-line text-xs">{tooltipContent}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={config.variant} className={`${config.className} gap-1 text-xs`}>
            <Icon className="h-3 w-3" />
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="whitespace-pre-line text-xs">{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function FreshnessStatusDot({ status }: { status?: FreshnessStatus | null }) {
  const effectiveStatus = status ?? 'ACTIVE';
  const colorMap = {
    ACTIVE: 'bg-green-500',
    WARNING: 'bg-yellow-500',
    STALE: 'bg-red-500',
    ARCHIVED: 'bg-gray-400',
  };

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colorMap[effectiveStatus]}`}
      title={STATUS_CONFIG[effectiveStatus].description}
    />
  );
}
