'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Tag } from 'lucide-react';
import { ContentActionsDropdown } from './ContentActionsDropdown';
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
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-muted/30">
        <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No content found</h3>
        <p className="text-muted-foreground max-w-sm mx-auto">
          Start building your content library by adding frequently asked questions
          and their answers.
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Question</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Usage</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right w-[60px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onView(item)}
            >
              <TableCell>
                <div className="space-y-1">
                  <p className="font-medium line-clamp-1">{item.question}</p>
                  <p className="text-sm text-muted-foreground line-clamp-1">
                    {item.answer}
                  </p>
                  {item.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      <div className="flex gap-1 flex-wrap">
                        {item.tags.slice(0, 3).map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-xs px-1.5 py-0"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {item.tags.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{item.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{item.category}</Badge>
              </TableCell>
              <TableCell>
                <Badge className={statusStyles[item.approvalStatus]}>
                  {item.approvalStatus}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {item.usageCount} {item.usageCount === 1 ? 'use' : 'uses'}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(item.updatedAt), {
                    addSuffix: true,
                  })}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <div onClick={(e) => e.stopPropagation()}>
                  <ContentActionsDropdown
                    item={item}
                    onEdit={() => onEdit(item)}
                    onView={() => onView(item)}
                    onDelete={() => onDelete(item)}
                    onApprove={() => onApprove(item)}
                    onDeprecate={() => onDeprecate(item)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
