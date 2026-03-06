'use client';

import { Check, X, CheckCheck, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface CherryPickControlsProps {
  isEnabled: boolean;
  selectedCount: number;
  totalHunks: number;
  onToggleMode: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onApply: () => void;
  onRevertToOlder?: () => void;
}

export const CherryPickControls = ({
  isEnabled,
  selectedCount,
  totalHunks,
  onToggleMode,
  onSelectAll,
  onClearSelection,
  onApply,
  onRevertToOlder,
}: CherryPickControlsProps) => {
  if (!isEnabled) {
    return (
      <Button variant="outline" size="sm" onClick={onToggleMode}>
        <Check className="h-4 w-4 mr-2" />
        Cherry-Pick Mode
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
      <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-900">
        {selectedCount} / {totalHunks} selected
      </Badge>
      
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={selectedCount === totalHunks}
          title="Select all changes"
        >
          <CheckCheck className="h-4 w-4 mr-1" />
          All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          disabled={selectedCount === 0}
          title="Clear selection"
        >
          Clear
        </Button>
      </div>
      
      <div className="flex-1" />
      
      {onRevertToOlder && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRevertToOlder}
          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30"
          title="Revert to the older version completely"
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          Revert to Older
        </Button>
      )}
      
      <Button
        variant="default"
        size="sm"
        onClick={onApply}
        disabled={selectedCount === 0}
      >
        Apply {selectedCount} Change{selectedCount !== 1 ? 's' : ''}
      </Button>
      
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleMode}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};
