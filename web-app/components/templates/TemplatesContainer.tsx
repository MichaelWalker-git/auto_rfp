'use client';

import { useState, useCallback } from 'react';
import { TemplatesHeader } from './TemplatesHeader';
import { TemplateCategoryFilter } from './TemplateCategoryFilter';
import { TemplateLibrary } from './TemplateLibrary';
import { CreateTemplateDialog } from './CreateTemplateDialog';
import { EditTemplateDialog } from './EditTemplateDialog';
import { DeleteTemplateDialog } from './DeleteTemplateDialog';
import {
  useTemplates,
  useTemplateCategories,
  useDeleteTemplate,
  usePublishTemplate,
  useCloneTemplate,
  type TemplateItem,
} from '@/lib/hooks/use-templates';
import { useToast } from '@/components/ui/use-toast';

interface TemplatesContainerProps {
  orgId: string;
}

export function TemplatesContainer({ orgId }: TemplatesContainerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TemplateItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateItem | null>(null);

  const { toast } = useToast();
  const { categories } = useTemplateCategories(orgId);
  const { items, total, isLoading, mutate } = useTemplates({
    orgId,
    category: selectedCategory,
    limit: 50,
    offset: 0,
  });
  const { deleteTemplate } = useDeleteTemplate(orgId);
  const { publish } = usePublishTemplate(orgId);
  const { clone } = useCloneTemplate(orgId);

  const filteredItems = searchQuery
    ? items.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : items;

  const handleCreateSuccess = useCallback(() => {
    setIsCreateOpen(false);
    mutate();
    toast({ title: 'Template created successfully' });
  }, [mutate, toast]);

  const handleDelete = useCallback(
    async (template: TemplateItem) => {
      try {
        await deleteTemplate(template.id);
        mutate();
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

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="py-6 px-4 sm:px-6 space-y-6">
        <TemplatesHeader
          total={total}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onCreateClick={() => setIsCreateOpen(true)}
        />

        <TemplateCategoryFilter
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />

        <TemplateLibrary
          items={filteredItems}
          isLoading={isLoading}
          onEdit={setEditTarget}
          onPublish={handlePublish}
          onClone={handleClone}
          onDelete={setDeleteTarget}
          orgId={orgId}
        />

        <CreateTemplateDialog
          isOpen={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          orgId={orgId}
          onSuccess={handleCreateSuccess}
        />

        <EditTemplateDialog
          isOpen={!!editTarget}
          onOpenChange={(open) => { if (!open) setEditTarget(null); }}
          template={editTarget}
          orgId={orgId}
          onSuccess={() => { setEditTarget(null); mutate(); }}
        />

        <DeleteTemplateDialog
          template={deleteTarget}
          onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </div>
  );
}