'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, RefreshCw } from 'lucide-react';
import { formatDateTime, statusBadgeVariant, statusLabel } from '../helpers';
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
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <CardTitle className="text-2xl flex items-center gap-3">
                  <FileText className="h-6 w-6" />
                  Executive Opportunity Brief
                </CardTitle>

                <div className="text-base font-medium text-foreground">{projectName}</div>

                <div className="text-sm text-muted-foreground">
                  {briefItem?.updatedAt ? `Last updated: ${formatDateTime(briefItem.updatedAt)}` : 'Not generated yet'}
                </div>
              </div>

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
            </div>

            {briefItem && (
              <div className="border rounded-lg p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wide">Overall Generation Progress</span>
                    <span className="text-lg font-bold">{Math.round(progressPercent)}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-3" />
                </div>
                
                <div className="flex items-center gap-2 text-xs">
                  {progressText?.includes('Working on') ? (
                    <Clock className="h-4 w-4 animate-spin flex-shrink-0" />
                  ) : progressPercent === 100 ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground flex-shrink-0" />
                  )}
                  <span className="text-muted-foreground">{progressText}</span>
                </div>
              </div>
            )}

            {sectionsState && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Section Status</p>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {SECTION_ORDER.map((k) => {
                    const v = sectionsState[k];
                    const waitingFor =
                      k === 'scoring' && prereqMissing.length ? `Waiting for: ${prereqMissing.join(', ')}` : undefined;

                    return (
                      <div key={k} className="border rounded p-2 text-center" title={waitingFor}>
                        <div className="flex justify-center mb-1">
                          {sectionIcon(k)}
                        </div>
                        <p className="text-xs font-medium capitalize">{k}</p>
                        <Badge variant={statusBadgeVariant(v)} className="mt-1 text-xs px-2 py-0">
                          {statusLabel(v)}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {queueDisabled && (
              <Alert>
                <Clock className="h-4 w-4" />
                <AlertDescription className="text-xs">{disableReason}</AlertDescription>
              </Alert>
            )}

            {regenError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{regenError}</AlertDescription>
              </Alert>
            )}
          </div>
      </CardHeader>

      <CardContent className="hidden" />
    </Card>
  );
}