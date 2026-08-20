'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface EmployeeErrorStateProps {
  onRetry: () => void;
}

/** Plain-language error state with retry (BR4.2). */
export const EmployeeErrorState = ({ onRetry }: EmployeeErrorStateProps) => (
  <div
    className="flex flex-col items-center gap-4 rounded-md border border-dashed p-12 text-center"
    data-testid="employee-error-state"
    role="alert"
  >
    <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
    <div className="space-y-1">
      <h3 className="text-lg font-semibold">Couldn&apos;t load employees</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        Something went wrong while loading the employee list. Your data is safe — try again.
      </p>
    </div>
    <Button variant="outline" onClick={onRetry} data-testid="employee-error-retry">
      <RefreshCw className="mr-2 h-4 w-4" />
      Try again
    </Button>
  </div>
);
