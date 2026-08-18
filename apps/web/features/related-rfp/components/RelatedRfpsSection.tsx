'use client';

import { useCallback, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/components/permission-wrapper';
import type { AgencyHistoryItem } from '@auto-rfp/core';

import { useRelatedRfps } from '../hooks/useRelatedRfps';
import { useRelatedRfpMutations } from '../hooks/useRelatedRfpMutations';
import { RelatedRfpRow } from './RelatedRfpRow';
import { AddRelatedRfpDialog } from './AddRelatedRfpDialog';

interface RelatedRfpsSectionProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

/**
 * Detail-page section (HOR-2610) listing related RFPs from the issuing agency —
 * both auto-discovered (AUTO) and user-added (MANUAL). Admins may remove AUTO
 * links (tombstoned so they won't reappear); anyone with opportunity:edit may
 * add manual links and trigger a refresh.
 */
export const RelatedRfpsSection = ({ orgId, projectId, oppId }: RelatedRfpsSectionProps) => {
  const { items, isLoading, isError, mutate } = useRelatedRfps({ orgId, projectId, oppId });
  const { addRelated, removeRelated, refreshRelated } = useRelatedRfpMutations({ orgId, projectId, oppId });

  const canRemoveAuto = usePermission('related_rfp:remove_auto');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const buildLinkedHref = useCallback(
    (linkedOpportunityId?: string | null) =>
      linkedOpportunityId
        ? `/organizations/${orgId}/projects/${projectId}/opportunities/${linkedOpportunityId}`
        : null,
    [orgId, projectId],
  );

  const handleAdd = useCallback(
    async (item: AgencyHistoryItem) => {
      await addRelated({
        relatedOppKey: item.relatedOppKey,
        title: item.title,
        organizationName: item.organizationName,
        postedDateIso: item.postedDateIso,
        dueDateIso: item.dueDateIso,
        sourceUrl: item.sourceUrl,
      });
    },
    [addRelated],
  );

  const handleRemove = useCallback(
    async (relatedOppKey: string) => {
      setRemovingKey(relatedOppKey);
      try {
        await removeRelated(relatedOppKey);
      } finally {
        setRemovingKey(null);
      }
    },
    [removeRelated],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshRelated();
      // Discovery runs async; revalidate again shortly to pick up new links.
      await mutate();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshRelated, mutate]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          Related RFPs
        </CardTitle>
        <div className="flex items-center gap-2">
          <AddRelatedRfpDialog orgId={orgId} projectId={projectId} oppId={oppId} onAdd={handleAdd} />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={isRefreshing}
            onClick={handleRefresh}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Couldn&apos;t load related RFPs. Try refreshing.
          </p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No related RFPs yet. We look for past RFPs from the same agency automatically — or add one
            manually.
          </p>
        ) : (
          items.map((item) => (
            <RelatedRfpRow
              key={item.id}
              item={item}
              linkedHref={buildLinkedHref(item.linkedOpportunityId)}
              canRemove={item.origin === 'MANUAL' || canRemoveAuto}
              isRemoving={removingKey === item.relatedOppKey}
              onRemove={handleRemove}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
};
