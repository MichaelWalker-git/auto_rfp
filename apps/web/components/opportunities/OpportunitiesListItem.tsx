'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { OpportunityItem } from '@auto-rfp/core';
import { Building2, ChevronRight, FileText, Hash, Loader2, Pencil, Tag, Trash2 } from 'lucide-react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useDeleteOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';
import { EditOpportunityDialog } from './edit-opportunity-dialog';

type Props = {
  item: OpportunityItem;
  onOpen?: (item: OpportunityItem) => void;
  onDeleted?: () => void;
  onUpdated?: (item: OpportunityItem) => void;
  className?: string;
};

const fmt = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

export function OpportunitiesListItem({ item, onOpen, onDeleted, onUpdated, className }: Props) {
  const posted = useMemo(() => fmt(item.postedDateIso), [item.postedDateIso]);
  const due = useMemo(() => fmt(item.responseDeadlineIso), [item.responseDeadlineIso]);
  const { currentOrganization } = useCurrentOrganization();
  const params = useParams();

  const { trigger: deleteOpportunity, isMutating: isDeleting } = useDeleteOpportunity();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const oppId = item.oppId ?? item.id;
  // Get projectId from URL params or fall back to item.projectId
  const projectId = (params?.projectId as string) || item.projectId;

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
    setDeleteError(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!oppId || !projectId) {
      setDeleteError('Missing projectId or oppId');
      return;
    }

    try {
      await deleteOpportunity({
        projectId,
        oppId,
        orgId: currentOrganization?.id || '',
      });
      setShowDeleteConfirm(false);
      onDeleted?.();
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete opportunity');
    }
  }, [oppId, projectId, deleteOpportunity, currentOrganization?.id, onDeleted]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setDeleteError(null);
  }, []);

  return (
    <Card className={cn('hover:shadow-md transition-all group cursor-pointer', className)}>
      <CardHeader className="p-4 pb-3">
        {/* Title and Status Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-base font-bold leading-tight truncate text-foreground">{item.title}</h3>
              {item.active ? (
                <Badge className="shrink-0 bg-green-600/90">Active</Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  Inactive
                </Badge>
              )}
            </div>

            {/* Organization */}
            {item.organizationName ? (
              <p className="text-xs text-muted-foreground mb-3 truncate">
                <Building2 className="inline h-3 w-3 mr-1"/>
                {item.organizationName}
              </p>
            ) : null}

            {/* Key Dates */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {posted ? (
                <div className="text-xs">
                  <span className="text-muted-foreground">Posted:</span>
                  <p className="font-medium text-foreground">{posted}</p>
                </div>
              ) : null}
              {due ? (
                <div className="text-xs">
                  <span className="text-muted-foreground">Due:</span>
                  <p className="font-medium text-foreground">{due}</p>
                </div>
              ) : null}
            </div>

            {/* Classification Badges */}
            <div className="flex flex-wrap gap-1.5">
              {item.type ? <Badge variant="outline" className="text-xs">{item.type}</Badge> : null}
              {item.setAside ? <Badge variant="outline" className="text-xs">{item.setAside}</Badge> : null}
              {item.naicsCode ? (
                <Badge variant="outline" className="text-xs gap-0.5">
                  <Tag className="h-2.5 w-2.5"/>
                  {item.naicsCode}
                </Badge>
              ) : null}
              {item.pscCode ? (
                <Badge variant="outline" className="text-xs gap-0.5">
                  <Tag className="h-2.5 w-2.5"/>
                  {item.pscCode}
                </Badge>
              ) : null}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="shrink-0 flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => onOpen?.(item)}
              className="gap-1.5"
            >
              Open
              <ChevronRight className="h-4 w-4"/>
            </Button>

            <EditOpportunityDialog
              item={item}
              onUpdated={onUpdated}
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  title="Edit opportunity"
                >
                  <Pencil className="h-4 w-4"/>
                </Button>
              }
            />

            <Button
              size="sm"
              variant="outline"
              onClick={handleDeleteClick}
              disabled={isDeleting}
              className="text-destructive hover:text-destructive"
              title="Delete opportunity"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin"/>
              ) : (
                <Trash2 className="h-4 w-4"/>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Description */}
      {item.description ? (
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
        </CardContent>
      ) : null}

      {/* IDs Footer */}
      {(item.solicitationNumber || item.noticeId) ? (
        <CardContent className="px-4 pb-3 pt-0">
          <div className="flex gap-2 text-xs text-muted-foreground">
            {item.solicitationNumber ? (
              <span className="inline-flex items-center gap-1">
                <Hash className="h-3 w-3"/>
                {item.solicitationNumber}
              </span>
            ) : null}
            {item.noticeId ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3"/>
                {item.noticeId}
              </span>
            ) : null}
          </div>
        </CardContent>
      ) : null}

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Opportunity</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-semibold text-foreground">"{item.title}"</span>?
              This will also delete all associated question files and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDelete} disabled={isDeleting}>
              Cancel
            </Button>

            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
