'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, RefreshCw } from 'lucide-react';
import { formatDate, statusBadgeVariant, statusLabel } from '../helpers';
import type { SectionKey, SectionStatus } from '../types';
import { exportBriefAsDocx } from '@/components/brief/helpers';

export function HeaderCard({
                             projectName,
                             briefItem,
                             regenError,
                             sectionsState,
                             sectionIcon,
                             prereqMissing,
                             progressPercent,
                             progressText,
                             onQueueMissing,
                             onQueueAll,
                             queueDisabled = false,
                           }: {
  projectName: string;
  briefItem: any;
  regenError: string | null;
  sectionsState: Record<SectionKey, SectionStatus> | null;
  sectionIcon: (k: SectionKey) => React.ReactNode;
  prereqMissing: readonly string[];
  progressPercent: number;
  progressText: string | null;
  onQueueMissing: () => void;
  onQueueAll: () => void;
  queueDisabled?: boolean;
}) {
  const SECTION_ORDER: SectionKey[] = useMemo(
    () => ['summary', 'deadlines', 'contacts', 'requirements', 'risks', 'scoring'],
    [],
  );

  const disableReason = queueDisabled ? 'A section is currently generating. Please wait until it finishes.' : undefined;

  return (
    <Card className="border-2">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <CardTitle className="text-2xl flex items-center gap-3">
              <FileText className="h-6 w-6" />
              Executive Opportunity Brief
            </CardTitle>

            <div className="text-base font-medium text-foreground">{projectName}</div>

            <div className="text-sm text-muted-foreground">
              {briefItem?.updatedAt ? `Last updated: ${formatDate(briefItem.updatedAt)}` : 'Not generated yet'}
            </div>

            {sectionsState && (
              <div className="flex flex-wrap gap-2 pt-2">
                {SECTION_ORDER.map((k) => {
                  const v = sectionsState[k];
                  const waitingFor =
                    k === 'scoring' && prereqMissing.length ? `Waiting for: ${prereqMissing.join(', ')}` : undefined;

                  return (
                    <Badge key={k} variant={statusBadgeVariant(v)} className="capitalize gap-2" title={waitingFor}>
                      {sectionIcon(k)}
                      {k}: {statusLabel(v)}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex gap-2 flex-wrap justify-end">
              {briefItem && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportBriefAsDocx(projectName, briefItem)}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Export DOCX
                </Button>
              )}

              <Button
                onClick={onQueueMissing}
                variant={briefItem ? 'outline' : 'default'}
                size="sm"
                disabled={queueDisabled}
                title={disableReason}
              >
                {queueDisabled ? 'Generating…' : briefItem ? 'Generate Missing' : 'Generate Brief'}
              </Button>

              <Button
                onClick={onQueueAll}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={!briefItem || queueDisabled}
                title={!briefItem ? 'Generate the brief first' : disableReason}
              >
                <RefreshCw className={`h-4 w-4 ${queueDisabled ? 'animate-spin' : ''}`} />
                {queueDisabled ? 'Generating…' : 'Generate All'}
              </Button>
            </div>

            {briefItem && (
              <div className="w-full space-y-2">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  {progressText?.includes('Working on') ? (
                    <Clock className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  {progressText}
                </div>
                <Progress value={progressPercent} className="h-2" />
              </div>
            )}

            {queueDisabled && (
              <div className="text-xs text-muted-foreground max-w-[520px] text-right">
                {disableReason}
              </div>
            )}

            {regenError && (
              <Alert variant="destructive" className="max-w-[520px]">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{regenError}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="hidden" />
    </Card>
  );
}