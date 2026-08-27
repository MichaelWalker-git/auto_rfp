'use client';

import { Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { EmployeeImportRunItem } from '@auto-rfp/core';

export interface ImportProgressBannerProps {
  run: EmployeeImportRunItem;
}

/**
 * Live progress banner while a generate-from-CVs run is RUNNING (BR5.1).
 * Announces count changes politely for screen readers (NFR4); the rest of the
 * page stays fully usable underneath it.
 */
export const ImportProgressBanner = ({ run }: ImportProgressBannerProps) => (
  <Alert aria-live="polite" data-testid="import-progress-banner">
    <Sparkles className="h-4 w-4" aria-hidden="true" />
    <AlertTitle>Generating employees from CVs…</AlertTitle>
    <AlertDescription data-testid="import-progress-counts">
      {run.documentsScanned} document{run.documentsScanned === 1 ? '' : 's'} scanned ·{' '}
      {run.cvsDetected} CV{run.cvsDetected === 1 ? '' : 's'} detected ·{' '}
      {run.employeesCreated} employee{run.employeesCreated === 1 ? '' : 's'} added ·{' '}
      {run.employeesUpdated} updated. You can keep working while the import runs.
    </AlertDescription>
  </Alert>
);
