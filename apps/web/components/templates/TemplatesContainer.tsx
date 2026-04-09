'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TemplatesHeader } from './TemplatesHeader';
import { TemplateCategoryFilter } from './TemplateCategoryFilter';
import { TemplateLibrary } from './TemplateLibrary';
import { DeleteTemplateDialog } from './DeleteTemplateDialog';
import { PermanentlyDeleteTemplateDialog } from './PermanentlyDeleteTemplateDialog';
import {
  useTemplates,
  useTemplateCategories,
  useDeleteTemplate,
  usePublishTemplate,
  useUnpublishTemplate,
  useCloneTemplate,
  useUnarchiveTemplate,
  usePermanentlyDeleteTemplate,
  type TemplateItem,
} from '@/lib/hooks/use-templates';
import { useToast } from '@/components/ui/use-toast';

interface TemplatesContainerProps {
  orgId: string;
}

export function TemplatesContainer({ orgId }: TemplatesContainerProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TemplateItem | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<TemplateItem | null>(null);

  const { toast } = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const { categories } = useTemplateCategories(orgId);
  const { items, total, isLoading, mutate } = useTemplates({
    orgId,
    category: selectedCategory,
    limit: 50,
    offset: 0,
    ...(viewMode === 'archived'
      ? { excludeArchived: 'false', status: 'ARCHIVED' }
      : {}),
  });
  const { deleteTemplate } = useDeleteTemplate(orgId);
  const { publish } = usePublishTemplate(orgId);
  const { unpublish } = useUnpublishTemplate(orgId);
  const { clone } = useCloneTemplate(orgId);
  const { unarchive } = useUnarchiveTemplate(orgId);
  const { permanentlyDelete } = usePermanentlyDeleteTemplate(orgId);

  /** Invalidate both active and archived template list caches */
  const invalidateAllTemplateLists = useCallback(() => {
    mutate();
    globalMutate((key: unknown) => typeof key === 'string' && key.includes('/templates/list'));
  }, [mutate, globalMutate]);

  const filteredItems = searchQuery
    ? items.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : items;

  const handleCreateClick = useCallback(() => {
    router.push(`/organizations/${orgId}/templates/create`);
  }, [router, orgId]);

  const handleEditClick = useCallback((template: TemplateItem) => {
    router.push(`/organizations/${orgId}/templates/${template.id}/edit`);
  }, [router, orgId]);

  const handleDelete = useCallback(
    async (template: TemplateItem) => {
      try {
        await deleteTemplate(template.id);
        invalidateAllTemplateLists();
        setDeleteTarget(null);
        toast({ title: 'Template archived' });
      } catch {
        toast({ title: 'Failed to archive template', variant: 'destructive' });
      }
    },
    [deleteTemplate, mutate, toast],
  );

  const handlePublish = useCallback(
    async (templateId: string) => {
      try {
        await publish(templateId);
        mutate();
        toast({ title: 'Template published' });
      } catch {
        toast({ title: 'Failed to publish template', variant: 'destructive' });
      }
    },
    [publish, mutate, toast],
  );

  const handleUnpublish = useCallback(
    async (templateId: string) => {
      try {
        await unpublish(templateId);
        mutate();
        toast({ title: 'Template unpublished' });
      } catch {
        toast({ title: 'Failed to unpublish template', variant: 'destructive' });
      }
    },
    [unpublish, mutate, toast],
  );

  const handleClone = useCallback(
    async (template: TemplateItem) => {
      try {
        await clone(template.id, {
          orgId,
          newName: `${template.name} (Copy)`,
        });
        mutate();
        toast({ title: 'Template cloned' });
      } catch {
        toast({ title: 'Failed to clone template', variant: 'destructive' });
      }
    },
    [clone, orgId, mutate, toast],
  );

  const handleUnarchive = useCallback(
    async (template: TemplateItem) => {
      try {
        await unarchive(template.id);
        invalidateAllTemplateLists();
        toast({ title: 'Template restored' });
      } catch {
        toast({ title: 'Failed to restore template', variant: 'destructive' });
      }
    },
    [unarchive, mutate, toast],
  );

  const handlePermanentDelete = useCallback(
    async (template: TemplateItem) => {
      try {
        await permanentlyDelete(template.id);
        invalidateAllTemplateLists();
        setPermanentDeleteTarget(null);
        toast({ title: 'Template permanently deleted' });
      } catch {
        toast({ title: 'Failed to delete template', variant: 'destructive' });
      }
    },
    [permanentlyDelete, mutate, toast],
  );

  return (
    <div className="container mx-auto p-12 space-y-6">
        <TemplatesHeader
          total={total}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onCreateClick={handleCreateClick}
        />

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'active' | 'archived')}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>

        {viewMode === 'active' && (
          <TemplateCategoryFilter
            categories={categories}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
          />
        )}

        <TemplateLibrary
          items={filteredItems}
          isLoading={isLoading}
          onEdit={handleEditClick}
          onPublish={handlePublish}
          onUnpublish={handleUnpublish}
          onClone={handleClone}
          onDelete={setDeleteTarget}
          onUnarchive={handleUnarchive}
          onPermanentlyDelete={setPermanentDeleteTarget}
          orgId={orgId}
          emptyMessage={viewMode === 'archived' ? 'No archived templates' : undefined}
        />

        <DeleteTemplateDialog
          template={deleteTarget}
          onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />

        <PermanentlyDeleteTemplateDialog
          template={permanentDeleteTarget}
          onConfirm={() => permanentDeleteTarget && handlePermanentDelete(permanentDeleteTarget)}
          onCancel={() => setPermanentDeleteTarget(null)}
        />
    </div>
  );
}
