'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { DisclosureLevelSchema, type DisclosureLevel } from '@auto-rfp/core';
import { DISCLOSURE_LABELS } from './DisclosureBadge';

const LEVELS = DisclosureLevelSchema.options;

interface DisclosureCardControlProps {
  level: DisclosureLevel;
  isDirty: boolean;
  isSaving: boolean;
  disabled?: boolean;
  onChange: (level: DisclosureLevel) => void;
  onSave: () => void;
}

/**
 * Inline disclosure editor shown on a past-performance card while management
 * mode is active: a level select plus a per-card save button that only enables
 * once the reviewer has changed the value.
 */
export const DisclosureCardControl = ({
  level,
  isDirty,
  isSaving,
  disabled,
  onChange,
  onSave,
}: DisclosureCardControlProps) => (
  <div className="mt-2 flex items-center gap-2" onClick={(e) => e.preventDefault()}>
    <Select
      value={level}
      disabled={disabled || isSaving}
      onValueChange={(value) => onChange(value as DisclosureLevel)}
    >
      <SelectTrigger className="h-8 w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((option) => (
          <SelectItem key={option} value={option}>
            {DISCLOSURE_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled || !isDirty || isSaving}
      onClick={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      {isSaving ? 'Saving…' : 'Save'}
    </Button>
  </div>
);
