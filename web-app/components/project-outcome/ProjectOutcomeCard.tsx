'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectOutcomeBadge } from './ProjectOutcomeBadge';
import { SetProjectOutcomeDialog } from './SetProjectOutcomeDialog';
import { useProjectOutcome } from '@/lib/hooks/use-project-outcome';
import PermissionWrapper from '@/components/permission-wrapper';
import { Settings2, DollarSign, Calendar, Award, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import type { ProjectOutcome } from '@auto-rfp/shared';

interface ProjectOutcomeCardProps {
  projectId: string;
  orgId: string;
  onOutcomeChange?: (outcome: ProjectOutcome) => void;
}

export function ProjectOutcomeCard({
  projectId,
  orgId,
  onOutcomeChange,
}: ProjectOutcomeCardProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { outcome, isLoading, refetch } = useProjectOutcome(orgId, projectId);

  const handleOutcomeSuccess = (newOutcome: ProjectOutcome) => {
    refetch();
    onOutcomeChange?.(newOutcome);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Project Outcome</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Project Outcome</CardTitle>
          <PermissionWrapper requiredPermission="project:edit">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="h-8 text-xs gap-1"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {outcome ? 'Update' : 'Set Outcome'}
            </Button>
          </PermissionWrapper>
        </CardHeader>

        <CardContent>
          {outcome ? (
            <div className="space-y-4">
              {/* Status Badge */}
              <div className="flex items-center gap-3">
                <ProjectOutcomeBadge status={outcome.status} size="lg" />
                {outcome.statusDate && (
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(outcome.statusDate), { addSuffix: true })}
                  </span>
                )}
              </div>

              {/* Win Data */}
              {outcome.status === 'WON' && outcome.winData && (
                <div className="grid gap-2 pt-2 border-t">
                  {outcome.winData.contractValue && (
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-green-600" />
                      <span className="font-medium">
                        ${outcome.winData.contractValue.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {outcome.winData.contractNumber && (
                    <div className="flex items-center gap-2 text-sm">
                      <Award className="h-4 w-4 text-muted-foreground" />
                      <span>{outcome.winData.contractNumber}</span>
                    </div>
                  )}
                  {outcome.winData.awardDate && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>Awarded {format(new Date(outcome.winData.awardDate), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                  {outcome.winData.keyFactors && (
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                      {outcome.winData.keyFactors}
                    </p>
                  )}
                </div>
              )}

              {/* Loss Data */}
              {outcome.status === 'LOST' && outcome.lossData && (
                <div className="grid gap-2 pt-2 border-t">
                  <div className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="font-medium">
                      {formatLossReason(outcome.lossData.lossReason)}
                    </span>
                  </div>
                  {outcome.lossData.winningContractor && (
                    <p className="text-xs text-muted-foreground">
                      Won by: {outcome.lossData.winningContractor}
                    </p>
                  )}
                  {outcome.lossData.lossReasonDetails && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {outcome.lossData.lossReasonDetails}
                    </p>
                  )}
                </div>
              )}

              {/* Source info */}
              {outcome.statusSource && outcome.statusSource !== 'MANUAL' && (
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  Source: {formatStatusSource(outcome.statusSource)}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                No outcome recorded yet
              </p>
              <PermissionWrapper requiredPermission="project:edit">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDialogOpen(true)}
                >
                  Set Outcome
                </Button>
              </PermissionWrapper>
            </div>
          )}
        </CardContent>
      </Card>

      <SetProjectOutcomeDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        projectId={projectId}
        orgId={orgId}
        currentOutcome={outcome}
        onSuccess={handleOutcomeSuccess}
      />
    </>
  );
}

function formatLossReason(reason: string): string {
  const labels: Record<string, string> = {
    PRICE_TOO_HIGH: 'Price Too High',
    TECHNICAL_SCORE: 'Technical Score',
    PAST_PERFORMANCE: 'Past Performance',
    INCUMBENT_ADVANTAGE: 'Incumbent Advantage',
    SMALL_BUSINESS_SETASIDE: 'Small Business Set-Aside',
    COMPLIANCE_ISSUE: 'Compliance Issue',
    LATE_SUBMISSION: 'Late Submission',
    OTHER: 'Other',
    UNKNOWN: 'Unknown',
  };
  return labels[reason] || reason;
}

function formatStatusSource(source: string): string {
  const labels: Record<string, string> = {
    MANUAL: 'Manual Entry',
    SAM_GOV_SYNC: 'SAM.gov Sync',
    FOIA_RESPONSE: 'FOIA Response',
  };
  return labels[source] || source;
}
