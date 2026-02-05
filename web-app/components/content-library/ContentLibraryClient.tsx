'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { ContentLibraryHeader } from './ContentLibraryHeader';
import { ContentLibraryTable } from './ContentLibraryTable';
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
  initialData?: {
    items: ContentLibraryItem[];
    total: number;
    categories: Array<{ name: string; count: number }>;
  };
}

const ITEMS_PER_PAGE = 20;

export function ContentLibraryClient({ orgId, kbId, initialData }: ContentLibraryClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();

  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || undefined;
  const status = searchParams.get('status') as ApprovalStatus | undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * ITEMS_PER_PAGE;

  // Helper to update URL params
  const updateUrlParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    router.push(`?${params.toString()}`);
  }, [searchParams, router]);

  // Dialog state (kept client-side as it's UI-only)
  const [dialogs, setDialogs] = useState({
    create: false,
    edit: false,
    view: false,
    delete: false,
  });
  const [selectedItem, setSelectedItem] = useState<ContentLibraryItem | null>(null);

  const { categories, items, total, isLoading, mutate } = useContentLibraryContext();
  const { approve } = useApproveContentLibraryItem(orgId, kbId);
  const { deprecate } = useDeprecateContentLibraryItem(orgId, kbId);
  // Debug logging
  console.log('ContentLibraryClient - Context data:', {
    items,
    itemsLength: items?.length,
    total,
    categories,
    isLoading
  });

  const hasMore = offset + ITEMS_PER_PAGE < total;

  // URL state handlers
  const handleSearchChange = useCallback((query: string) => {
    updateUrlParams({ search: query || null, page: '1' });
  }, [updateUrlParams]);

  const handleCategoryChange = useCallback((newCategory: string | undefined) => {
    updateUrlParams({ category: newCategory || null, page: '1' });
  }, [updateUrlParams]);

  const handleStatusChange = useCallback((newStatus: ApprovalStatus | undefined) => {
    updateUrlParams({ status: newStatus || null, page: '1' });
  }, [updateUrlParams]);

  const handleLoadMore = useCallback(() => {
    updateUrlParams({ page: (page + 1).toString() });
  }, [page, updateUrlParams]);

  // Dialog handlers
  const openDialog = (dialogName: keyof typeof dialogs, item?: ContentLibraryItem) => {
    if (item) setSelectedItem(item);
    setDialogs(prev => ({ ...prev, [dialogName]: true }));
  };

  const closeDialog = (dialogName: keyof typeof dialogs) => {
    setDialogs(prev => ({ ...prev, [dialogName]: false }));
    if (dialogName !== 'edit') setSelectedItem(null);
  };

  // Action handlers using server actions
  const handleApprove = async (item: ContentLibraryItem) => {
    startTransition(async () => {
      try {
        await approve(item.id);
        toast({
          title: 'Success',
          description: 'Content item approved',
        });
        // Refresh the data
        await mutate();
      } catch (error) {
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to approve item',
          variant: 'destructive',
        });
      }
    });
  };

  const handleDeprecate = async (item: ContentLibraryItem) => {
    startTransition(async () => {
      try {
        await deprecate(item.id);
        toast({
          title: 'Success',
          description: 'Content item deprecated',
        });
        // Refresh the data
        await mutate();
      } catch (error) {
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to deprecate item',
          variant: 'destructive',
        });
      }
    });
  };

  const handleSuccess = async () => {
    startTransition(async () => {
      // Refresh the data
      await mutate();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <ContentLibraryHeader
        searchQuery={search}
        onSearchChange={handleSearchChange}
        selectedCategory={category || undefined}
        onCategoryChange={handleCategoryChange}
        selectedStatus={status as ApprovalStatus | undefined}
        onStatusChange={handleStatusChange}
        categories={categories}
        onCreateClick={() => openDialog('create')}
        total={total}
      />

      <ContentLibraryTable
        items={items}
        orgId={orgId}
        isLoading={isLoading || isPending}
        onEdit={(item) => openDialog('edit', item)}
        onView={(item) => openDialog('view', item)}
        onDelete={(item) => openDialog('delete', item)}
        onApprove={handleApprove}
        onDeprecate={handleDeprecate}
      />

      {hasMore && !isLoading && !isPending && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={handleLoadMore}>
            Load more ({items.length} of {total})
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <CreateContentDialog
        isOpen={dialogs.create}
        onOpenChange={(open) => !open && closeDialog('create')}
        orgId={orgId}
        kbId={kbId}
        categories={categories}
        onSuccess={handleSuccess}
      />

      <EditContentDialog
        isOpen={dialogs.edit}
        onOpenChange={(open) => !open && closeDialog('edit')}
        item={selectedItem}
        categories={categories}
        onSuccess={handleSuccess}
      />

      <ContentDetailDialog
        isOpen={dialogs.view}
        onOpenChange={(open) => !open && closeDialog('view')}
        item={selectedItem}
        onEdit={() => {
          closeDialog('view');
          openDialog('edit', selectedItem!);
        }}
        onApprove={() => selectedItem && handleApprove(selectedItem)}
        onDeprecate={() => selectedItem && handleDeprecate(selectedItem)}
      />

      <DeleteContentDialog
        isOpen={dialogs.delete}
        onOpenChange={(open) => !open && closeDialog('delete')}
        item={selectedItem}
        onSuccess={handleSuccess}
      />
    </div>
  );
}