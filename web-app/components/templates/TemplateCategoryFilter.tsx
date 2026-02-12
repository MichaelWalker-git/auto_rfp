'use client';

import { Badge } from '@/components/ui/badge';
import type { TemplateCategoryInfo } from '@/lib/hooks/use-templates';

interface TemplateCategoryFilterProps {
  categories: TemplateCategoryInfo[];
  selectedCategory: string | undefined;
  onCategoryChange: (category: string | undefined) => void;
}

export function TemplateCategoryFilter({
  categories,
  selectedCategory,
  onCategoryChange,
}: TemplateCategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onCategoryChange(undefined)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          !selectedCategory
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        All
        <Badge variant="secondary" className="ml-1 text-xs">
          {categories.reduce((sum, c) => sum + c.count, 0)}
        </Badge>
      </button>
      {categories
        .filter((c) => c.count > 0)
        .map((cat) => (
          <button
            key={cat.name}
            onClick={() =>
              onCategoryChange(selectedCategory === cat.name ? undefined : cat.name)
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedCategory === cat.name
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {cat.label}
            <Badge variant="secondary" className="ml-1 text-xs">
              {cat.count}
            </Badge>
          </button>
        ))}
    </div>
  );
}