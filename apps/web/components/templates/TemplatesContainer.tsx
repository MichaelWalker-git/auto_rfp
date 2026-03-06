'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TemplatesHeader } from './TemplatesHeader';
import { TemplateCategoryFilter } from './TemplateCategoryFilter';
import { TemplateLibrary } from './TemplateLibrary';
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
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
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
    <div className="container mx-auto p-12 space-y-6">
        <TemplatesHeader
          total={total}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onCreateClick={handleCreateClick}
        />

        <TemplateCategoryFilter
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />

        <TemplateLibrary
          items={filteredItems}
          isLoading={isLoading}
          onEdit={handleEditClick}
          onPublish={handlePublish}
          onClone={handleClone}
          onDelete={setDeleteTarget}
          orgId={orgId}
        />

        <DeleteTemplateDialog
          template={deleteTarget}
          onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
    </div>
  );
}
