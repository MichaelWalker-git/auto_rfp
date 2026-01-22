'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SectionKey, SectionStatus } from '../types';
import { statusBadgeVariant, statusLabel } from '../helpers';

const IN_PROGRESS_STATUSES = new Set([
  'QUEUED',
  'IN_PROGRESS',
  'RUNNING',
  'PENDING',
  'STARTED',
]);

function isInProgressStatus(st?: SectionStatus | string | null) {
  if (!st) return false;
  return IN_PROGRESS_STATUSES.has(String(st).toUpperCase());
}

type Props = {
  sectionOrder: SectionKey[];
  briefItem: any;
  prereq: { ok: true } | { ok: false; missing: readonly string[] };
  sectionIcon: (k: SectionKey) => React.ReactNode;
  sectionTitle: (k: SectionKey) => string;
  onQueueSection: (k: SectionKey) => void;
  isSectionBusy?: (k: SectionKey) => boolean;
}

export function SectionsControlCard(
  {
    sectionOrder,
    briefItem,
    prereq,
    sectionIcon,
    sectionTitle,
    onQueueSection,
    isSectionBusy,
  }: Props
) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Sections</CardTitle>
        <div className="text-sm text-muted-foreground">
          This pipeline is async. Buttons below enqueue work; statuses update automatically.
        </div>
      </CardHeader>

      <CardContent className="grid gap-3 md:grid-cols-3">
        {sectionOrder.map((k) => {
          const st = (briefItem?.sections as any)?.[k]?.status as SectionStatus;

          return (
            <div key={k} className="rounded-lg border p-4 flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {sectionIcon(k)}
                  <div className="font-semibold text-sm">{sectionTitle(k)}</div>
                  <Badge variant={statusBadgeVariant(st)} className="ml-1">
                    {statusLabel(st)}
                  </Badge>
                </div>

                {k === 'scoring' && !prereq.ok && (
                  <div className="text-xs text-muted-foreground">
                    Waiting for: <span className="font-medium">{prereq.missing.join(', ')}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 items-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onQueueSection(k)}
                  disabled={isSectionBusy && isSectionBusy(k) || isInProgressStatus(st)}
                >
                  {isInProgressStatus(st) ? 'Generating…' : 'Generate'}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}