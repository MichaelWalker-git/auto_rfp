'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, User, GitCompare, RotateCcw } from 'lucide-react';
import { getRelativeTime } from '@/lib/hooks/use-document-versions';
import type { RFPDocumentVersion } from '@auto-rfp/core';

interface VersionListItemProps {
  version: RFPDocumentVersion;
  isLatest?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  onCompare?: () => void;
  onRevert?: () => void;
}

export const VersionListItem = ({
  version,
  isLatest = false,
  isSelected = false,
  onSelect,
  onCompare,
  onRevert,
}: VersionListItemProps) => {
  return (
    <div
      className={`p-3 border rounded-lg transition-colors cursor-pointer ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50 hover:bg-accent/50'
      }`}
      onClick={onSelect}
    >
      {/* Row 1: Version title + Latest badge + buttons */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">v{version.versionNumber}</span>
          {isLatest && (
            <Badge variant="secondary" className="text-xs">
              Latest
            </Badge>
          )}
        </div>
        
        {!isLatest && (
          <div className="flex items-center gap-1">
            {onCompare && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onCompare();
                }}
                title="Compare with latest"
              >
                <GitCompare className="h-3.5 w-3.5" />
              </Button>
            )}
            {onRevert && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onRevert();
                }}
                title="Revert to this version"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
      
      {/* Row 2: Created by and created at (always visible) */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          {version.createdByName || 'Unknown'}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {getRelativeTime(version.createdAt)}
        </span>
      </div>
      
      {/* Row 3: Change note (optional) */}
      {version.changeNote && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {version.changeNote}
        </p>
      )}
    </div>
  );
};
