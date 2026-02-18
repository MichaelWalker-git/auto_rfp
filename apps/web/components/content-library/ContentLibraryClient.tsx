'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Plus, ShieldAlert, Tag } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

import { PageHeader } from '@/components/layout/page-header';
import { PageSearch } from '@/components/layout/page-search';
import { ContentActionsDropdown } from './ContentActionsDropdown';
import { FreshnessStatusBadge } from './FreshnessStatusBadge';
import { CreateContentDialog } from './CreateContentDialog';
import { EditContentDialog } from './EditContentDialog';
import { ContentDetailDialog } from './ContentDetailDialog';
import { DeleteContentDialog } from './DeleteContentDialog';
import { useContentLibraryContext } from './ContentLibraryProvider';
import {
  ApprovalStatus,
  ContentLibraryItem,
  useApproveContentLibraryItem,
  useDeprecateContentLibraryItem
} from '@/lib/hooks/use-content-library';

interface ContentLibraryClientProps {
  orgId: string;
  kbId: string;
}

const ITEMS_PER_PAGE = 20;

const statusStyles: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  DEPRECATED: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function ContentLibraryClient({ orgId, kbId }: ContentLibraryClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();

  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || undefined;
  const status = searchParams.get('status') as ApprovalStatus | undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * ITEMS_PER_PAGE;

  const updateUrlParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) params.delete(key);
      else params.set(key, value);
    });
    router.push(`?${params.toString()}`);
  }, [searchParams, router]);

  const [dialogs, setDialogs] = useState({ create: false, edit: false, view: false, delete: false });
  const [selectedItem, setSelectedItem] = useState<ContentLibraryItem | null>(null);

  const { categories, items, total, isLoading, mutate } = useContentLibraryContext();
  const { approve } = useApproveContentLibraryItem(orgId, kbId);
  const { deprecate } = useDeprecateContentLibraryItem(orgId, kbId);

  const hasMore = offset + ITEMS_PER_PAGE < total;

  const handleSearchChange = useCallback((query: string) => {
    updateUrlParams({ search: query || null, page: '1' });
  }, [updateUrlParams]);

  const openDialog = (dialogName: keyof typeof dialogs, item?: ContentLibraryItem) => {
    if (item) setSelectedItem(item);
    setDialogs(prev => ({ ...prev, [dialogName]: true }));
  };

  const closeDialog = (dialogName: keyof typeof dialogs) => {
    setDialogs(prev => ({ ...prev, [dialogName]: false }));
    if (dialogName !== 'edit') setSelectedItem(null);
  };

  const handleApprove = async (item: ContentLibraryItem) => {
    startTransition(async () => {
      try { await approve(item.id); toast({ title: 'Content item approved' }); await mutate(); }
      catch (e) { toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }); }
    });
  };

  const handleDeprecate = async (item: ContentLibraryItem) => {
    startTransition(async () => {
      try { await deprecate(item.id); toast({ title: 'Content item deprecated' }); await mutate(); }
      catch (e) { toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' }); }
    });
  };

  const handleSuccess = async () => { startTransition(async () => { await mutate(); }); };

  return (
    <div className="space-y-6">
      {/* Header — same pattern as TemplatesHeader */}
      <PageHeader
        title="Content Library"
        description={`${total} ${total === 1 ? 'item' : 'items'} in your library`}
        actions={
          <>
            <PageSearch
              value={search}
              onChange={handleSearchChange}
              placeholder="Search questions..."
              widthClass="w-64"
            />
            {orgId && kbId && (
              <Button variant="outline" asChild>
                <Link href={`/organizations/${orgId}/knowledge-base/${kbId}/stale-report`}>
                  <ShieldAlert className="h-4 w-4 mr-2" />
                  Stale Report
                </Link>
              </Button>
            )}
            <Button onClick={() => openDialog('create')}>
              <Plus className="h-4 w-4 mr-2" />
              Add Content
            </Button>
          </>
        }
      />

      {/* Category + Status filter pills — same pattern as TemplateCategoryFilter */}
      <div className="flex flex-wrap gap-2">
        {/* Status pills */}
        <button
          onClick={() => updateUrlParams({ status: null, page: '1' })}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            !status ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          All Status
          <Badge variant="secondary" className="ml-1 text-xs">{total}</Badge>
        </button>
        {(['DRAFT', 'APPROVED', 'DEPRECATED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => updateUrlParams({ status: status === s ? null : s, page: '1' })}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              status === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}

        {categories.length > 0 && <span className="h-8 w-px bg-border self-center mx-1" />}

        {/* Category pills */}
        {categories.filter(c => c.count > 0).map((cat) => (
          <button
            key={cat.name}
            onClick={() => updateUrlParams({ category: category === cat.name ? null : cat.name, page: '1' })}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              category === cat.name ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {cat.name}
            <Badge variant="secondary" className="ml-1 text-xs">{cat.count}</Badge>
          </button>
        ))}
      </div>

      {/* Content list */}
      {isLoading || isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 px-4 rounded-xl bg-muted/30">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md shrink-0" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/10 px-12 py-20">
          <div className="rounded-full bg-muted p-4 mb-6">
            <FileText className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No content found</h3>
          <p className="text-muted-foreground text-center max-w-md mb-6">
            Start building your content library by adding frequently asked questions and their answers.
          </p>
          <Button onClick={() => openDialog('create')}>
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Content
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card
              key={item.id}
              className="group px-4 py-3 hover:bg-muted/60 transition-colors cursor-pointer"
              onClick={() => openDialog('view', item)}
            >
              <div className="flex items-start gap-3">
                <div className="mt-1 shrink-0">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="space-y-1.5 min-w-0 flex-1">
                  {/* Question row */}
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-semibold text-primary/60 uppercase shrink-0 mt-0.5">Q</span>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="text-sm line-clamp-1">{item.question}</span>
                      <Badge className={`text-[10px] shrink-0 ${statusStyles[item.approvalStatus]}`}>{item.approvalStatus}</Badge>
                      <FreshnessStatusBadge
                        status={(item as Record<string, unknown>).freshnessStatus as 'ACTIVE' | 'WARNING' | 'STALE' | 'ARCHIVED' | undefined}
                        reason={(item as Record<string, unknown>).staleReason as string | undefined}
                        staleSince={(item as Record<string, unknown>).staleSince as string | undefined}
                        compact
                      />
                    </div>
                    <div className="shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <ContentActionsDropdown
                        item={item}
                        onEdit={() => openDialog('edit', item)}
                        onView={() => openDialog('view', item)}
                        onDelete={() => openDialog('delete', item)}
                        onApprove={() => handleApprove(item)}
                        onDeprecate={() => handleDeprecate(item)}
                      />
                    </div>
                  </div>
                  {/* Answer row */}
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-semibold text-muted-foreground/50 uppercase shrink-0 mt-0.5">A</span>
                    <p className="text-sm text-muted-foreground line-clamp-2">{item.answer}</p>
                  </div>
                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pl-5">
                    <Badge variant="secondary" className="text-[10px]">{item.category}</Badge>
                    {item.tags.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        {item.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                        ))}
                        {item.tags.length > 3 && <span>+{item.tags.length - 3}</span>}
                      </span>
                    )}
                    <span>· {item.usageCount} {item.usageCount === 1 ? 'use' : 'uses'}</span>
                    <span>· {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !isLoading && !isPending && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => updateUrlParams({ page: (page + 1).toString() })}>
            Load more ({items.length} of {total})
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <CreateContentDialog isOpen={dialogs.create} onOpenChange={(o) => !o && closeDialog('create')} orgId={orgId} kbId={kbId} categories={categories} onSuccess={handleSuccess} />
      <EditContentDialog isOpen={dialogs.edit} onOpenChange={(o) => !o && closeDialog('edit')} item={selectedItem} categories={categories} onSuccess={handleSuccess} />
      <ContentDetailDialog isOpen={dialogs.view} onOpenChange={(o) => !o && closeDialog('view')} item={selectedItem} onEdit={() => { closeDialog('view'); openDialog('edit', selectedItem!); }} onApprove={() => selectedItem && handleApprove(selectedItem)} onDeprecate={() => selectedItem && handleDeprecate(selectedItem)} />
      <DeleteContentDialog isOpen={dialogs.delete} onOpenChange={(o) => !o && closeDialog('delete')} item={selectedItem} onSuccess={handleSuccess} />
    </div>
  );
}
