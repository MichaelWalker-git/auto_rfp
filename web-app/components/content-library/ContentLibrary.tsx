'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { ContentLibraryHeader } from './ContentLibraryHeader';
import { ContentLibraryTable } from './ContentLibraryTable';
import { CreateContentDialog } from './CreateContentDialog';
import { EditContentDialog } from './EditContentDialog';
import { ContentDetailDialog } from './ContentDetailDialog';
import { DeleteContentDialog } from './DeleteContentDialog';
import {
  type ApprovalStatus,
  type ContentLibraryItem,
  useApproveContentLibraryItem,
  useContentLibraryCategories,
  useContentLibraryItems,
  useDeprecateContentLibraryItem,
} from '@/lib/hooks/use-content-library';

interface ContentLibraryProps {
  orgId: string;
  kbId: string;
}

export function ContentLibrary({ orgId, kbId }: ContentLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<
    ApprovalStatus | undefined
  >();
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ContentLibraryItem | null>(
    null
  );

  const { toast } = useToast();

  // Fetch data
  const {
    items,
    total,
    hasMore,
    isLoading,
    mutate: mutateItems,
  } = useContentLibraryItems({
    orgId,
    kbId,
    query: searchQuery || undefined,
    category: selectedCategory,
    approvalStatus: selectedStatus,
    excludeArchived: true,
    limit,
    offset,
  });

  const { categories, mutate: mutateCategories } = useContentLibraryCategories(orgId);
  const { approve: approveContent } = useApproveContentLibraryItem(orgId, kbId);
  const { deprecate } = useDeprecateContentLibraryItem(orgId, kbId, selectedItem?.id || '');

  // Handlers
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setOffset(0);
  }, []);

  const handleCategoryChange = useCallback(
    (category: string | undefined) => {
      setSelectedCategory(category);
      setOffset(0);
    },
    []
  );

  const handleStatusChange = useCallback(
    (status: ApprovalStatus | undefined) => {
      setSelectedStatus(status);
      setOffset(0);
    },
    []
  );

  const handleCreateSuccess = useCallback(() => {
    mutateItems();
    mutateCategories();
  }, [mutateItems, mutateCategories]);

  const handleEditSuccess = useCallback(() => {
    mutateItems();
  }, [mutateItems]);

  const handleDeleteSuccess = useCallback(() => {
    mutateItems();
    mutateCategories();
    setSelectedItem(null);
  }, [mutateItems, mutateCategories]);

  const handleEdit = (item: ContentLibraryItem) => {
    setSelectedItem(item);
    setIsEditOpen(true);
  };

  const handleView = (item: ContentLibraryItem) => {
    setSelectedItem(item);
    setIsViewOpen(true);
  };

  const handleDelete = (item: ContentLibraryItem) => {
    setSelectedItem(item);
    setIsDeleteOpen(true);
  };

  const handleApprove = async (item: ContentLibraryItem) => {
    try {
      await approveContent(item.id);
      toast({
        title: 'Success',
        description: 'Content item approved',
      });
      mutateItems();
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to approve item',
        variant: 'destructive',
      });
    }
  };

  const handleDeprecate = async (item: ContentLibraryItem) => {
    try {
      await deprecate();
      toast({
        title: 'Success',
        description: 'Content item deprecated',
      });
      mutateItems();
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to deprecate item',
        variant: 'destructive',
      });
    }
  };

  const handleLoadMore = () => {
    setOffset((prev) => prev + limit);
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="py-6 px-4 sm:px-6">
        <div className="flex flex-col gap-6">
          <ContentLibraryHeader
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            selectedCategory={selectedCategory}
            onCategoryChange={handleCategoryChange}
            selectedStatus={selectedStatus}
            onStatusChange={handleStatusChange}
            categories={categories}
            onCreateClick={() => setIsCreateOpen(true)}
            total={total}
          />

          <ContentLibraryTable
            items={items}
            orgId={orgId}
            isLoading={isLoading}
            onEdit={handleEdit}
            onView={handleView}
            onDelete={handleDelete}
            onApprove={handleApprove}
            onDeprecate={handleDeprecate}
          />

          {hasMore && !isLoading && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={handleLoadMore}>
                Load more ({items.length} of {total})
              </Button>
            </div>
          )}

          {/* Dialogs */}
          <CreateContentDialog
            isOpen={isCreateOpen}
            onOpenChange={setIsCreateOpen}
            orgId={orgId}
            kbId={kbId}
            categories={categories}
            onSuccess={handleCreateSuccess}
          />

          <EditContentDialog
            isOpen={isEditOpen}
            onOpenChange={setIsEditOpen}
            item={selectedItem}
            categories={categories}
            onSuccess={handleEditSuccess}
          />

          <ContentDetailDialog
            isOpen={isViewOpen}
            onOpenChange={setIsViewOpen}
            item={selectedItem}
            onEdit={() => {
              setIsViewOpen(false);
              setIsEditOpen(true);
            }}
            onApprove={() => selectedItem && handleApprove(selectedItem)}
            onDeprecate={() => selectedItem && handleDeprecate(selectedItem)}
          />

          <DeleteContentDialog
            isOpen={isDeleteOpen}
            onOpenChange={setIsDeleteOpen}
            item={selectedItem}
            onSuccess={handleDeleteSuccess}
          />
        </div>
      </div>
    </div>
  );
}
