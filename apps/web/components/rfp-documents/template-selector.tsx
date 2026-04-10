'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTemplates } from '@/lib/hooks/use-templates';

const AUTO_VALUE = '__auto__';

interface TemplateSelectorProps {
  orgId: string;
  /** Document type key used as template category filter (e.g. "TECHNICAL_PROPOSAL") */
  documentType: string;
  /** Selected template ID, or "" for auto-select */
  value: string;
  onChange: (templateId: string) => void;
  disabled?: boolean;
  className?: string;
}

export const TemplateSelector = ({
  orgId,
  documentType,
  value,
  onChange,
  disabled,
  className,
}: TemplateSelectorProps) => {
  const { items, isLoading } = useTemplates(
    documentType
      ? { orgId, category: documentType, excludeArchived: 'true', limit: 50 }
      : null,
  );

  if (isLoading) {
    return <Skeleton className={className ?? 'h-7 w-full max-w-full'} />;
  }

  const selectValue = value || AUTO_VALUE;
  const published = items.filter((t) => t.status === 'PUBLISHED');
  const drafts = items.filter((t) => t.status === 'DRAFT');

  const handleChange = (val: string) => {
    onChange(val === AUTO_VALUE ? '' : val);
  };

  return (
    <Select value={selectValue} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className={className ?? 'h-7 text-xs w-full min-w-0'}>
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate"><SelectValue placeholder="Auto" /></span>
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO_VALUE} className="text-xs">
          Auto (most recent published)
        </SelectItem>
        {published.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] text-muted-foreground">Published</SelectLabel>
            {published.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                {t.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {drafts.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] text-muted-foreground">Drafts</SelectLabel>
            {drafts.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                {t.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {items.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No templates for this type
          </div>
        )}
      </SelectContent>
    </Select>
  );
};
