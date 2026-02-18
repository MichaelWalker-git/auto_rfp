'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Tag } from 'lucide-react';
import { ContentActionsDropdown } from './ContentActionsDropdown';
import { FreshnessStatusBadge } from './FreshnessStatusBadge';
import type { ContentLibraryItem } from '@/lib/hooks/use-content-library';
import { formatDistanceToNow } from 'date-fns';

interface ContentLibraryTableProps {
  items: ContentLibraryItem[];
  orgId: string;
  isLoading: boolean;
  onEdit: (item: ContentLibraryItem) => void;
  onView: (item: ContentLibraryItem) => void;
  onDelete: (item: ContentLibraryItem) => void;
  onApprove: (item: ContentLibraryItem) => void;
  onDeprecate: (item: ContentLibraryItem) => void;
}

const statusStyles: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  DEPRECATED: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function ContentLibraryTable({
  items,
  orgId,
  isLoading,
  onEdit,
  onView,
  onDelete,
  onApprove,
  onDeprecate,
}: ContentLibraryTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/10 px-12 py-20">
        <div className="rounded-full bg-muted p-4 mb-6">
          <FileText className="h-10 w-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No content found</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Start building your content library by adding frequently asked questions
          and their answers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Card
          key={item.id}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60 transition-colors cursor-pointer"
          onClick={() => onView(item)}
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="mt-0.5">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium truncate">{item.question}</span>

                <Badge className={`text-[10px] ${statusStyles[item.approvalStatus]}`}>
                  {item.approvalStatus}
                </Badge>

                <FreshnessStatusBadge
                  status={(item as Record<string, unknown>).freshnessStatus as 'ACTIVE' | 'WARNING' | 'STALE' | 'ARCHIVED' | undefined}
                  reason={(item as Record<string, unknown>).staleReason as string | undefined}
                  staleSince={(item as Record<string, unknown>).staleSince as string | undefined}
                  compact
                />
              </div>

              <p className="text-sm text-muted-foreground line-clamp-1">
                {item.answer}
              </p>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="text-[10px]">{item.category}</Badge>

                {item.tags.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    {item.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                        {tag}
                      </Badge>
                    ))}
                    {item.tags.length > 3 && (
                      <span>+{item.tags.length - 3}</span>
                    )}
                  </span>
                )}

                <span>· {item.usageCount} {item.usageCount === 1 ? 'use' : 'uses'}</span>

                <span>
                  · {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 pl-8 sm:pl-0" onClick={(e) => e.stopPropagation()}>
            <ContentActionsDropdown
              item={item}
              onEdit={() => onEdit(item)}
              onView={() => onView(item)}
              onDelete={() => onDelete(item)}
              onApprove={() => onApprove(item)}
              onDeprecate={() => onDeprecate(item)}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}
