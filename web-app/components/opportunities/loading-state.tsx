'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

export function LoadingState() {
  return (
    <div className="flex items-center justify-center rounded-2xl border bg-muted/20 py-14">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Searching SAM.gov…
      </div>
    </div>
  );
}