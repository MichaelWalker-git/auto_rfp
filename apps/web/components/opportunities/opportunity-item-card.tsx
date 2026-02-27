'use client';

import React, { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import type { OpportunityItem } from '@auto-rfp/core';
import { Building2, FileText, Hash, Loader2, Pencil, Tag, Trash2, UserCircle2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

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

// ─── Description section — auto-fetches if description is a URL ──────────────

const isUrl = (s: string | null | undefined): boolean => {
  if (!s) return false;
  return s.startsWith('http://') || s.startsWith('https://');
};

const useAutoDescription = (orgId: string | undefined, descriptionOrUrl: string | null | undefined) => {
  const needsFetch = isUrl(descriptionOrUrl);
  const [fetched, setFetched] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);

  React.useEffect(() => {
    if (!needsFetch || !orgId || !descriptionOrUrl) return;
    setLoading(true);
    authFetcher(
      `${env.BASE_API_URL}/search-opportunities/opportunity-description?orgId=${encodeURIComponent(orgId)}`,
      { method: 'POST', body: JSON.stringify({ descriptionUrl: descriptionOrUrl }) },
    )
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as { description?: string; content?: string; opportunityDescription?: string };
        setFetched(data.description ?? data.content ?? data.opportunityDescription ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, descriptionOrUrl]);

  return {
    description: needsFetch ? fetched : (descriptionOrUrl ?? null),
    isLoading: needsFetch && isLoading,
  };
};

const DESCRIPTION_PROSE = cn(
  'prose prose-sm max-w-none text-sm text-muted-foreground leading-relaxed',
  '[&_p]:mb-2 [&_p:last-child]:mb-0',
  '[&_div]:mb-1',
  '[&_br]:block',
  '[&_ul]:mb-2 [&_ul]:pl-5 [&_ul>li]:list-disc [&_ul>li]:mb-0.5',
  '[&_ol]:mb-2 [&_ol]:pl-5 [&_ol>li]:list-decimal [&_ol>li]:mb-0.5',
  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_b]:font-semibold [&_b]:text-foreground',
  '[&_em]:italic',
  '[&_u]:underline',
  '[&_s]:line-through',
  '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-3 [&_h1]:mb-1',
  '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1',
  '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-2 [&_h3]:mb-0.5',
  '[&_h4]:text-xs [&_h4]:font-medium [&_h4]:text-foreground [&_h4]:mt-1 [&_h4]:mb-0.5',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:mb-2',
  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-left',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  '[&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono',
  '[&_hr]:border-border [&_hr]:my-2',
  '[&_span]:leading-relaxed',
);

const DescriptionSection = ({ item, orgId }: { item: OpportunityItem; orgId?: string }) => {
  const { description, isLoading } = useAutoDescription(orgId, item.description);

  if (!item.description) return null;

  return (
    <div className="mt-2 pt-2 border-t" onClick={e => e.stopPropagation()}>
      {isLoading ? (
        <div className="space-y-1.5">
          <div className="h-3 w-full bg-muted animate-pulse rounded" />
          <div className="h-3 w-5/6 bg-muted animate-pulse rounded" />
          <div className="h-3 w-4/6 bg-muted animate-pulse rounded" />
        </div>
      ) : description ? (
        <div
          className={DESCRIPTION_PROSE}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(description, {
            ALLOWED_TAGS: [
              'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
              'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
              'ul', 'ol', 'li',
              'a', 'blockquote', 'code', 'pre', 'hr',
              'table', 'thead', 'tbody', 'tr', 'th', 'td',
              'img',
            ],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style'],
            FORCE_BODY: true,
          }) }}
        />
      ) : null}
    </div>
  );
};

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

export const OpportunityItemCard = ({
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
}: OpportunityItemCardProps) => {
  const { currentOrganization } = useCurrentOrganization();
  const params = useParams();

  const { trigger: deleteOpportunity, isMutating: isDeleting } = useDeleteOpportunity();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const oppId = item.oppId ?? item.id;
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
      className={`group cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/20 flex flex-col bg-gradient-to-br from-background to-muted/30 ${className || ''}`}
    >
      <CardContent className="p-3 flex-1 flex flex-col gap-1.5" onClick={() => onOpen?.(item)}>
        {/* Top row: title + status badge (top-right) */}
        <div className="flex items-start gap-2">
          <h3 className="text-xs font-semibold leading-snug line-clamp-3 text-foreground/90 flex-1">
            {item.title}
          </h3>
          <Badge className={`shrink-0 text-xs h-4 px-1.5 mt-0.5 ${
            item.active ? 'bg-green-600/90' : 'bg-muted text-muted-foreground'
          }`}>
            {item.active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        {/* Meta */}
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground flex-1">
          {item.organizationName && (
            <span className="flex items-center gap-1 truncate">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{item.organizationName}</span>
            </span>
          )}
          {(item.noticeId ?? item.solicitationNumber) && (
            <span className="flex items-center gap-1 font-mono truncate">
              <Hash className="h-3 w-3 shrink-0" />
              <span className="truncate">{item.noticeId ?? item.solicitationNumber}</span>
            </span>
          )}
          {item.responseDeadlineIso && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3 shrink-0" />
              Due {new Date(item.responseDeadlineIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>

        {/* Classification badges */}
        <div className="flex flex-wrap gap-1">
          {item.naicsCode && (
            <Badge variant="outline" className="text-xs h-4 px-1 text-muted-foreground">
              <Tag className="h-2.5 w-2.5 mr-0.5" />
              {item.naicsCode}
            </Badge>
          )}
          {item.setAside && (
            <Badge variant="outline" className="text-xs h-4 px-1">
              {item.setAside}
            </Badge>
          )}
          {item.type && item.type !== item.setAside && (
            <Badge variant="outline" className="text-xs h-4 px-1">
              {item.type}
            </Badge>
          )}
        </div>
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
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
};
