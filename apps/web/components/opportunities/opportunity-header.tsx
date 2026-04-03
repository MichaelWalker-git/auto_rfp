'use client';

import React from 'react';
import Link from 'next/link';
import { AlertCircle, Check, ExternalLink, Loader2, Pencil, Send, Target, Trash2, X } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOpportunityContext } from './opportunity-context';
import { useCurrentOrganization } from '@/context/organization-context';
import {
  OpportunityHeaderView,
  OpportunityHeaderEdit,
  OpportunityDeleteDialog,
  OpportunityDescription,
  useOpportunityHeaderActions,
} from './opportunity-header/';
import { useEmitOpportunityEvent } from '@/lib/hooks/use-emit-opportunity-event';

// ─── Component ────────────────────────────────────────────────────────────────

export const OpportunityHeader = () => {
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
    onSuccess: refetch,
  });

  const { emitEvent, isEmitting } = useEmitOpportunityEvent();
  const isAlreadyEmitted = !!opportunity?.eventBridgeEmittedAt;
  const pocUrl = opportunity?.pocUrl;

  const handleEmitEvent = async () => {
    if (!orgId || !projectId || !oppId) return;
    const result = await emitEvent(orgId, projectId, oppId);
    if (result) refetch();
  };

  // Show loading skeleton until orgId and opportunity are both loaded
  // This prevents showing errors when orgId is undefined
  if (isLoading || !opportunity || !orgId) {
    return (
      <Card>
        <CardHeader>
          <div className="space-y-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error state only after orgId and opportunity have loaded
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
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
                orgId={orgId}
                projectId={projectId}
                oppId={oppId}
                onStageChanged={refetch}
              />
            )}
          </div>

          {/* Action buttons */}
          <div className="shrink-0 flex items-center gap-2">
            {isEditing ? (
              <>
                <Button type="submit" form="opp-edit-form" size="sm" disabled={isUpdating}>
                  {isUpdating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(false)}
                  disabled={isUpdating}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link href={briefUrl}>
                    <Target className="h-4 w-4 mr-2" />
                    Executive Brief
                  </Link>
                </Button>
                {currentOrganization?.enablePOCGeneration && (
                  pocUrl ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={pocUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View POC
                      </a>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleEmitEvent}
                      disabled={isEmitting || isAlreadyEmitted}
                    >
                      {(isEmitting || isAlreadyEmitted) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      Develop POC
                    </Button>
                  )
                )}
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  Delete
                </Button>
              </>
            )}
          </div>
        </CardHeader>

        {/* Description (read-only mode only) */}
        {!isEditing && (
          <CardContent className="space-y-3">
            {opportunity.description ? (
              <OpportunityDescription description={opportunity.description} />
            ) : (
              <span className="text-sm text-muted-foreground">No description available.</span>
            )}
          </CardContent>
        )}
      </Card>

      {/* Request Review — feature not yet implemented */}
      {/* <Dialog open={showRequestReview} onOpenChange={setShowRequestReview}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
              Request Review
            </DialogTitle>
            <DialogDescription>
              This feature is not implemented yet. Proposal review workflows are coming soon.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequestReview(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog> */}

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
