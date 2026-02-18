'use client';

import React, { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import type { OpportunityItem } from '@auto-rfp/core';
import { Building2, FileText, Hash, Loader2, Pencil, Tag, Trash2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
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
import { useDeleteOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';
import { EditOpportunityDialog } from './edit-opportunity-dialog';

export type OpportunityItemCardVariant = 'full' | 'compact';

export interface OpportunityItemCardProps {
  item: OpportunityItem;
  onOpen?: (item: OpportunityItem) => void;
  onDeleted?: () => void;
  onUpdated?: (item: OpportunityItem) => void;
  variant?: OpportunityItemCardVariant;
  className?: string;
  showDescription?: boolean;
  showIds?: boolean;
  showDeleteButton?: boolean;
  showEditButton?: boolean;
}

function MetaRow({
                   icon,
                   label,
                   children,
                 }: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        {icon}
        <span>{label}</span>
      </span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}

export function OpportunityItemCard({
                                      item,
                                      onOpen,
                                      onDeleted,
                                      onUpdated,
                                      variant = 'full',
                                      className,
                                      showDescription = true,
                                      showIds = true,
                                      showDeleteButton = true,
                                      showEditButton = true,
                                    }: OpportunityItemCardProps) {
  const { currentOrganization } = useCurrentOrganization();
  const params = useParams();

  const { trigger: deleteOpportunity, isMutating: isDeleting } = useDeleteOpportunity();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const oppId = item.oppId ?? item.id;
  // Get projectId from URL params or fall back to item.projectId
  const projectId = (params?.projectId as string) || item.projectId;
  const isCompact = variant === 'compact';

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
      <Card
        onClick={() => onOpen?.(item)}
        className={`group cursor-pointer rounded-2xl border bg-background transition-all hover:shadow-md ${className || ''}`}
      >
        <CardContent  className="p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              {/* Header with title and status badge */}
              <div className="flex items-center gap-2 mb-2">
                <h3 className={`truncate font-semibold tracking-tight ${
                  isCompact ? 'text-sm' : 'text-base'
                }`}>
                  {item.title}
                </h3>
                <Badge className={`shrink-0 gap-1 whitespace-nowrap ${
                  item.active 
                    ? 'bg-green-600/90 text-xs' 
                    : 'variant-secondary text-xs'
                }`}>
                  {item.active ? '✓ Active' : 'Inactive'}
                </Badge>
              </div>

              {/* Organization info */}
              {item.organizationName && !isCompact ? (
                <p className="text-xs text-muted-foreground mb-3 truncate">
                  <Building2 className="inline h-3 w-3 mr-1" />
                  {item.organizationName}
                </p>
              ) : null}

              {/* Classification badges - avoid duplicates */}
              <div className="flex flex-wrap gap-1.5">
                {item.type && item.type !== item.setAside ? (
                  <Badge variant="outline" className="text-xs">
                    {item.type}
                  </Badge>
                ) : null}
                {item.setAside ? (
                  <Badge variant="outline" className="text-xs">
                    {item.setAside}
                  </Badge>
                ) : null}
                {item.naicsCode ? (
                  <Badge variant="outline" className="text-xs gap-0.5">
                    <Tag className="h-2.5 w-2.5" />
                    {item.naicsCode}
                  </Badge>
                ) : null}
                {item.pscCode ? (
                  <Badge variant="outline" className="text-xs gap-0.5">
                    <Tag className="h-2.5 w-2.5" />
                    {item.pscCode}
                  </Badge>
                ) : null}
              </div>
            </div>

            {/* Action Buttons - hidden by default, visible on hover */}
            <div 
              className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              {showEditButton && (
                <EditOpportunityDialog
                  item={item}
                  onUpdated={onUpdated}
                  trigger={
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Edit opportunity"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  }
                />
              )}
              {showDeleteButton && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDeleteClick}
                  disabled={isDeleting}
                  title="Delete opportunity"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* IDs Row - Only show in full variant and when enabled */}
          {showIds && !isCompact && (item.solicitationNumber || item.noticeId) && (
            <div className="mt-2 grid gap-1.5">
              <MetaRow icon={<Hash className="h-3.5 w-3.5" />} label="Notice:">
                {item.noticeId ?? '—'}
              </MetaRow>

              <MetaRow icon={<FileText className="h-3.5 w-3.5" />} label="Solicitation:">
                {item.solicitationNumber ?? '—'}
              </MetaRow>
            </div>
          )}

          {/* Description - Only show in full variant and when enabled */}
          {showDescription && !isCompact && item.description ? (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-3">
              {item.description}
            </p>
          ) : null}
        </CardContent>
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