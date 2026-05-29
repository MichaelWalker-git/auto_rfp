'use client';

import { TemplateCard } from './TemplateCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { TemplateItem } from '@/lib/hooks/use-templates';

interface TemplateLibraryProps {
  items: TemplateItem[];
  isLoading: boolean;
  onEdit: (template: TemplateItem) => void;
  onPublish: (templateId: string) => void;
  onClone: (template: TemplateItem) => void;
  onDelete: (template: TemplateItem) => void;
  orgId: string;
}

export function TemplateLibrary({
  items,
  isLoading,
  onEdit,
  onPublish,
  onClone,
  onDelete,
  orgId,
}: TemplateLibraryProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground text-lg">No templates found</p>
        <p className="text-muted-foreground text-sm mt-1">
          Create your first template to get started
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          onEdit={onEdit}
          onPublish={onPublish}
          onClone={onClone}
          onDelete={onDelete}
          orgId={orgId}
        />
      ))}
    </div>
  );
}
