'use client';

import React from 'react';
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type LinearSyncStatus, LINEAR_SYNC_STATUSES } from '@/lib/hooks/use-rfp-documents';

interface Props {
  status: LinearSyncStatus;
  lastSyncedAt?: string | null;
}

export function LinearSyncIndicator({ status, lastSyncedAt }: Props) {
  if (status === 'NOT_SYNCED') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Not yet synced to Linear</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (status === 'SYNCED') {
    const syncDate = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Unknown';
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Synced to Linear • {syncDate}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center">
          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Linear sync failed — will retry automatically</p>
      </TooltipContent>
    </Tooltip>
  );
}