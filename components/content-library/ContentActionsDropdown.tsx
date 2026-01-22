'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  CheckCircle,
  XCircle,
  Copy,
} from 'lucide-react';
import type { ContentLibraryItem } from '@/lib/hooks/use-content-library';
import { useToast } from '@/components/ui/use-toast';

interface ContentActionsDropdownProps {
  item: ContentLibraryItem;
  onEdit: () => void;
  onView: () => void;
  onDelete: () => void;
  onApprove: () => void;
  onDeprecate: () => void;
}

export function ContentActionsDropdown({
  item,
  onEdit,
  onView,
  onDelete,
  onApprove,
  onDeprecate,
}: ContentActionsDropdownProps) {
  const { toast } = useToast();

  const handleCopyAnswer = () => {
    navigator.clipboard.writeText(item.answer);
    toast({
      title: 'Copied',
      description: 'Answer copied to clipboard',
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onView}>
          <Eye className="h-4 w-4 mr-2" />
          View
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4 mr-2" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyAnswer}>
          <Copy className="h-4 w-4 mr-2" />
          Copy Answer
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {item.approvalStatus === 'DRAFT' && (
          <DropdownMenuItem onClick={onApprove}>
            <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
            Approve
          </DropdownMenuItem>
        )}
        {item.approvalStatus === 'APPROVED' && (
          <DropdownMenuItem onClick={onDeprecate}>
            <XCircle className="h-4 w-4 mr-2 text-orange-600" />
            Deprecate
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
