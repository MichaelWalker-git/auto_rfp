'use client';

import React from 'react';
import type { SavedSearch } from '@auto-rfp/core';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { ExternalLink, MoreHorizontal, Power, Trash2 } from 'lucide-react';

type Props = {
  orgId: string;
  savedSearch: SavedSearch;
  disabled?: boolean;

  onDelete: (s: SavedSearch) => Promise<void> | void;
  onToggleEnabled: (s: SavedSearch) => Promise<void> | void;

  /**
   * Optional override if you want to handle "open/use" differently
   * (e.g. open in modal instead of navigating).
   */
  onUse?: (s: SavedSearch) => void;
};

function buildSearchUrl(orgId: string, s: SavedSearch) {
  // Avoid double-encoding: build JSON then encode once.
  const serialized = encodeURIComponent(JSON.stringify(s.criteria ?? {}));
  return `/organizations/${orgId}/opportunities?search=${serialized}`;
}

export function SavedSearchActionsDropdown({
                                             orgId,
                                             savedSearch,
                                             disabled,
                                             onDelete,
                                             onToggleEnabled,
                                             onUse,
                                           }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const openSearch = () => {
    try {
      if (onUse) return onUse(savedSearch);

      const href = buildSearchUrl(orgId, savedSearch);
      router.push(href);
    } catch (e: any) {
      toast({
        title: 'Open failed',
        description: e?.message ?? 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-xl" disabled={disabled}>
          <MoreHorizontal className="h-4 w-4"/>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>

        <DropdownMenuItem onClick={openSearch} disabled={disabled}>
          <ExternalLink className="mr-2 h-4 w-4"/>
          Use search
        </DropdownMenuItem>

        <DropdownMenuSeparator/>

        <DropdownMenuItem onClick={() => onToggleEnabled(savedSearch)} disabled={disabled}>
          <Power className="mr-2 h-4 w-4"/>
          {savedSearch.isEnabled ? 'Disable' : 'Activate'}
        </DropdownMenuItem>

        <DropdownMenuSeparator/>

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(savedSearch)}
          disabled={disabled}
        >
          <Trash2 className="mr-2 h-4 w-4"/>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}