'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';
import { DisclosureLevelSchema, type DisclosureLevel } from '@auto-rfp/core';
import { DISCLOSURE_LABELS } from './DisclosureBadge';

const LEVELS = DisclosureLevelSchema.options;

interface DisclosureManagementBarProps {
  isActive: boolean;
  dirtyCount: number;
  isSaving: boolean;
  isClassifying: boolean;
  onEnter: () => void;
  onExit: () => void;
  onClassifyAll: () => void;
  onMarkAllAs: (level: DisclosureLevel) => void;
  onSaveAll: () => void;
}

/**
 * Header cluster for the past-performance list. Collapsed it's a single
 * "Manage disclosure" button; expanded it exposes Classify all / Mark all as… /
 * Save all, and each card renders its own inline select + save.
 */
export const DisclosureManagementBar = ({
  isActive,
  dirtyCount,
  isSaving,
  isClassifying,
  onEnter,
  onExit,
  onClassifyAll,
  onMarkAllAs,
  onSaveAll,
}: DisclosureManagementBarProps) => {
  if (!isActive) {
    return (
      <Button variant="outline" onClick={onEnter}>
        <ShieldCheck className="h-4 w-4 mr-2" />
        Manage disclosure
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={onClassifyAll} disabled={isClassifying}>
        {isClassifying ? 'Classifying…' : 'Classify all'}
      </Button>
      <Select value="" onValueChange={(value) => onMarkAllAs(value as DisclosureLevel)}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Mark all as…" />
        </SelectTrigger>
        <SelectContent>
          {LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {DISCLOSURE_LABELS[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={onSaveAll} disabled={isSaving || dirtyCount === 0}>
        {isSaving ? 'Saving…' : `Save all${dirtyCount ? ` (${dirtyCount})` : ''}`}
      </Button>
      <Button variant="ghost" onClick={onExit} disabled={isSaving}>
        Done
      </Button>
    </div>
  );
};
