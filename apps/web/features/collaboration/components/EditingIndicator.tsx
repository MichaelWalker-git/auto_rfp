'use client';

import type { PresenceItem } from '@auto-rfp/core';

interface EditingIndicatorProps {
  editors: PresenceItem[];
}

export function EditingIndicator({ editors }: EditingIndicatorProps) {
  if (editors.length === 0) return null;

  const names = editors.map((e) => e.displayName).join(', ');

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
      <span>
        <strong>{names}</strong> {editors.length === 1 ? 'is' : 'are'} editing…
      </span>
    </div>
  );
}
