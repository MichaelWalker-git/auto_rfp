'use client';

import React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCw,
  Send,
  Target,
  X
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { useOpportunityContext } from './opportunity-context';
import { useCurrentOrganization } from '@/context/organization-context';
import {
  OpportunityDeleteDialog,
  OpportunityDescription,
  OpportunityHeaderEdit,
  OpportunityHeaderView,
  useOpportunityHeaderActions,
} from './opportunity-header/';
import { useEmitOpportunityEvent } from '@/lib/hooks/use-emit-opportunity-event';
import { useToast } from '@/components/ui/use-toast';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { PermissionButton } from '@/components/ui/permission-button';
import { OpportunityReviewStatusSection, RequestOpportunityApprovalButton } from '@/features/opportunity-approval';
import { useSyncApn } from '@/lib/hooks/use-apn';

// ─── Component ────────────────────────────────────────────────────────────────

interface OpportunityHeaderProps {
  /**
   * When explicitly false, the Generate POC button is disabled with an
   * "upload solicitation documents first" explanation.
   */
  hasSolicitationDocs?: boolean;
}

export const OpportunityHeader = ({ hasSolicitationDocs }: OpportunityHeaderProps = {}) => {
  const { projectId, oppId, opportunity, isLoading, error, refetch } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id;

  const backUrl = orgId ? `/organizations/${orgId}/projects/${projectId}/opportunities` : '#';
  const briefUrl = orgId ? `/organizations/${orgId}/projects/${projectId}/brief?opportunityId=${oppId}` : '#';

  // Always call hooks at the top (React rules)
  const {
    isEditing,
    setIsEditing,
    isUpdating,
    submitError,
    setSubmitError,
    handleUpdate,
    showDeleteConfirm,
    setShowDeleteConfirm,
    isDeleting,
    deleteError,
    setDeleteError,
    handleDelete,
  } = useOpportunityHeaderActions({
    oppId,
    projectId,
    orgId,
    backUrl,
    currentDeliveryConstraint: opportunity?.deliveryLocationConstraint,
    // Passed so a header edit preserves the LossData fields this form does not collect
    // (bid amounts, evaluation scores) instead of replacing the whole attribute.
    currentLossData: opportunity?.lossData,
    onSuccess: refetch,
  });
  const { trigger: syncApn, isMutating: isSyncingApn } = useSyncApn();

  const { emitEvent, isEmitting } = useEmitOpportunityEvent();
  const { toast } = useToast();
  const isAlreadyEmitted = !!opportunity?.eventBridgeEmittedAt;
  const pocUrl = opportunity?.pocUrl;
  const isFailed = opportunity?.pocGenState === 'failed';
  const isGenerating = isEmitting || (isAlreadyEmitted && !pocUrl && !isFailed);

  const dashboardBase = process.env.NEXT_PUBLIC_POC_DASHBOARD_URL ?? 'https://poc.horustech.dev/dashboard';
  const pocDashboardUrl = `${dashboardBase.replace(/\/$/, '')}/${oppId}`;

  // force=true bypasses the emit idempotency guard so a failed run can be retried.
  const handleEmitEvent = async (force = false) => {
    if (!orgId || !projectId || !oppId) return;
    try {
      await emitEvent(orgId, projectId, oppId, force);
      refetch();
    } catch (err: unknown) {
      toast({
        title: 'POC generation failed to start',
        description: err instanceof Error ? err.message : 'Failed to emit event',
        variant: 'destructive',
      });
    }
  };

  const handleSyncApn = async () => {
    if (!orgId || !projectId || !oppId || !opportunity) return;
    try {
      const expectedCloseDate = opportunity.responseDeadlineIso
        ? (opportunity.responseDeadlineIso.includes('T')
          ? opportunity.responseDeadlineIso
          : `${opportunity.responseDeadlineIso}T00:00:00.000Z`)
        : new Date().toISOString();

      const result = await syncApn({
        orgId,
        projectId,
        oppId,
        existingApnId: opportunity.apnOpportunityId ?? undefined,
        opportunity: {
          title: opportunity.title,
          value: opportunity.baseAndAllOptionsValue ?? 0,
          expectedCloseDate,
          status: opportunity.status ?? 'IDENTIFIED',
          description: opportunity.description ?? undefined,
        },
        customer: {
          name: opportunity.organizationName ?? currentOrganization?.name ?? 'Unknown',
        },
      });

      if (result.apnSyncError) {
        toast({
          title: 'APN sync failed',
          description: result.apnSyncError,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Synced to AWS Partner Central' });
      }
      refetch();
    } catch (err: unknown) {
      toast({
        title: 'APN sync failed',
        description: err instanceof Error ? err.message : 'Failed to sync to APN',
        variant: 'destructive',
      });
    }
  };

  // Show loading skeleton until orgId and opportunity are both loaded
  // This prevents showing errors when orgId is undefined
  if (isLoading || !opportunity || !orgId) {
    return (
      <Card>
        <CardHeader>
          <div className="space-y-2">
            <Skeleton className="h-6 w-3/4"/>
            <Skeleton className="h-4 w-1/2"/>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4"/>
            <Skeleton className="h-4 w-2/3"/>
            <Skeleton className="h-20 w-full"/>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error state only after orgId and opportunity have loaded
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4"/>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            {/* Info — takes remaining space */}
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <OpportunityHeaderEdit
                  opportunity={opportunity}
                  onSubmit={handleUpdate}
                  submitError={submitError}
                  onClearError={() => setSubmitError(null)}
                />
              ) : (
                <OpportunityHeaderView
                  opportunity={opportunity}
                />
              )}
            </div>

            {/* Action buttons — pinned to right of title */}
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {isEditing ? (
                <>
                  <Button type="submit" form="opp-edit-form" size="sm" disabled={isUpdating}>
                    {isUpdating ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : <Check className="h-4 w-4 mr-1"/>}
                    Save
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)}
                          disabled={isUpdating}>
                    <X className="h-4 w-4 mr-1"/>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <RequestOpportunityApprovalButton
                    orgId={orgId}
                    projectId={projectId}
                    opportunityId={oppId}
                    opportunityName={opportunity.title}
                    onSuccess={refetch}
                  />
                  <Button variant="outline" size="sm" asChild>
                    <Link href={briefUrl}>
                      <Target className="h-4 w-4 sm:mr-1"/>
                      <span className="hidden sm:inline">Brief</span>
                    </Link>
                  </Button>
                  {currentOrganization?.enablePOCGeneration && (
                    pocUrl ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            <ExternalLink className="h-4 w-4 sm:mr-1"/>
                            <span className="hidden sm:inline">POC</span>
                            <ChevronDown className="h-4 w-4 ml-1"/>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <a href={pocUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-2"/>
                              Open POC
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a href={pocDashboardUrl} target="_blank" rel="noopener noreferrer">
                              <LayoutDashboard className="h-4 w-4 mr-2"/>
                              Open Dashboard
                            </a>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : isGenerating ? (
                      <Button variant="outline" size="sm" disabled>
                        <Loader2 className="h-4 w-4 sm:mr-1 animate-spin"/>
                        <span className="hidden sm:inline">Generating…</span>
                      </Button>
                    ) : isFailed ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEmitEvent(true)}
                        title={opportunity.pocFailureReason ?? 'POC generation failed'}
                        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                      >
                        <RotateCw className="h-4 w-4 sm:mr-1"/>
                        <span className="hidden sm:inline">Retry POC</span>
                      </Button>
                    ) : (
                      <DisabledReasonTooltip
                        reason={hasSolicitationDocs === false ? 'Upload solicitation documents first' : null}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={hasSolicitationDocs === false}
                          onClick={() => handleEmitEvent()}
                        >
                          <Send className="h-4 w-4 sm:mr-1"/>
                          <span className="hidden sm:inline">Generate POC</span>
                        </Button>
                      </DisabledReasonTooltip>
                    )
                  )}
                  <PermissionButton
                    requiredPermission="opportunity:edit"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    <Pencil className="h-4 w-4 sm:mr-1"/>
                    <span className="hidden sm:inline">Edit</span>
                  </PermissionButton>
                  <PermissionButton
                    requiredPermission="apn:sync"
                    variant="outline"
                    size="sm"
                    disabled={isSyncingApn}
                    onClick={handleSyncApn}
                    title={opportunity.apnSyncError ?? undefined}
                    className={opportunity.apnSyncError ? 'border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800' : undefined}
                  >
                    {isSyncingApn
                      ? <Loader2 className="h-4 w-4 sm:mr-1 animate-spin"/>
                      : <RefreshCw className="h-4 w-4 sm:mr-1"/>}
                    <span className="hidden sm:inline">Sync APN</span>
                  </PermissionButton>
                  <PermissionDeleteButton
                    requiredPermission="opportunity:delete"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    isLoading={isDeleting}
                  />
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Description (read-only mode only) */}
        {!isEditing && (
          <CardContent className="space-y-3">
            {opportunity.description ? (
              <OpportunityDescription description={opportunity.description}/>
            ) : (
              <span className="text-sm text-muted-foreground">No description available.</span>
            )}

            {/* Review Status */}
            <OpportunityReviewStatusSection
              orgId={orgId}
              projectId={projectId}
              opportunityId={oppId}
            />
          </CardContent>
        )}
      </Card>

      {/* Delete confirmation dialog */}
      <OpportunityDeleteDialog
        open={showDeleteConfirm}
        opportunityTitle={opportunity.title}
        isDeleting={isDeleting}
        deleteError={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        onClearError={() => setDeleteError(null)}
      />
    </>
  );
};
