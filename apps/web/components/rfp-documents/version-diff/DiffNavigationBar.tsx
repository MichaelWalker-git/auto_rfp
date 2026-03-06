'use client';

import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DiffNavigationBarProps {
  currentIndex: number;
  totalHunks: number;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
}

export const DiffNavigationBar = ({
  currentIndex,
  totalHunks,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: DiffNavigationBarProps) => {
  if (totalHunks === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md text-sm text-muted-foreground">
        No changes detected
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md">
      <span className="text-sm font-medium">
        Change {currentIndex + 1} of {totalHunks}
      </span>
      
      <div className="flex items-center gap-1 ml-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onPrev}
          disabled={!hasPrev}
          title="Previous change (Ctrl+↑)"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onNext}
          disabled={!hasNext}
          title="Next change (Ctrl+↓)"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
