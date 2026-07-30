'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Banknote, Calendar, Award, AlertTriangle, Target, Settings2 } from 'lucide-react';
import { format } from 'date-fns';
import { LOSS_REASON_LABELS, TERMINAL_OPPORTUNITY_STATUSES } from '@auto-rfp/core';
import type { OpportunityItem, OpportunityStatus, LossReasonCategory } from '@auto-rfp/core';
import { OpportunityStatusBadge } from './opportunity-status-badge';
import { PermissionButton } from '@/components/ui/permission-button';
import { SetOpportunityOutcomeDialog } from './set-opportunity-outcome-dialog';

interface OpportunityOutcomeSummaryProps {
  opportunity: OpportunityItem;
  orgId: string;
  projectId: string;
  oppId: string;
  onOutcomeChange?: () => void;
}

/**
 * Post-Award outcome summary. Displays the opportunity's outcome (status +
 * win/loss detail + reason) and lets a user edit it via a dialog that writes
 * directly to the opportunity entity.
 */
export const OpportunityOutcomeSummary = ({
  opportunity,
  orgId,
  projectId,
  oppId,
  onOutcomeChange,
}: OpportunityOutcomeSummaryProps) => {
  const status = (opportunity.status as OpportunityStatus | undefined) ?? 'IDENTIFIED';
  const isTerminal = TERMINAL_OPPORTUNITY_STATUSES.includes(status);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Target className="h-4 w-4" />
          Project Outcome
        </CardTitle>
        <div className="flex items-center gap-2">
          <OpportunityStatusBadge status={status} />
          <PermissionButton
            requiredPermission="opportunity:edit"
            variant="ghost"
            size="sm"
            onClick={() => setIsDialogOpen(true)}
            className="h-8 text-xs gap-1"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {isTerminal ? 'Update' : 'Set Outcome'}
          </PermissionButton>
        </div>
      </CardHeader>
      <CardContent>
        {!isTerminal ? (
          <p className="text-sm text-muted-foreground">
            No outcome recorded yet. Set the bid status to Won, Lost, No Bid, or Withdrawn in the
            opportunity Edit form to record an outcome.
          </p>
        ) : (
          <div className="space-y-3">
            {opportunity.outcomeComment && (
              <p className="text-sm text-muted-foreground leading-relaxed">{opportunity.outcomeComment}</p>
            )}

            {status === 'WON' && opportunity.winData && (
              <div className="space-y-2 pt-2 border-t">
                {opportunity.winData.contractValue ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Banknote className="h-4 w-4 text-emerald-600" />
                    <span className="font-medium">
                      {opportunity.winData.contractValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                    </span>
                  </div>
                ) : null}
                {opportunity.winData.contractNumber && (
                  <div className="flex items-center gap-2 text-sm">
                    <Award className="h-4 w-4 text-muted-foreground" />
                    <span>{opportunity.winData.contractNumber}</span>
                  </div>
                )}
                {opportunity.winData.awardDate && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>Awarded {format(new Date(opportunity.winData.awardDate), 'MMM d, yyyy')}</span>
                  </div>
                )}
                {opportunity.winData.keyFactors && (
                  <div className="pt-2 border-t">
                    <p className="text-xs font-medium mb-1">Key Success Factors:</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{opportunity.winData.keyFactors}</p>
                  </div>
                )}
              </div>
            )}

            {status === 'LOST' && opportunity.lossData && (
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="font-medium">
                    {LOSS_REASON_LABELS[opportunity.lossData.lossReason as LossReasonCategory] ?? opportunity.lossData.lossReason}
                  </span>
                </div>
                {opportunity.lossData.winningContractor && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Award className="h-4 w-4" />
                    <span>Won by: {opportunity.lossData.winningContractor}</span>
                  </div>
                )}
                {opportunity.lossData.lossReasonDetails && (
                  <div className="pt-2 border-t">
                    <p className="text-xs font-medium mb-1">Details:</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{opportunity.lossData.lossReasonDetails}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <SetOpportunityOutcomeDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        orgId={orgId}
        projectId={projectId}
        oppId={oppId}
        opportunity={opportunity}
        onSuccess={onOutcomeChange}
      />
    </Card>
  );
};
