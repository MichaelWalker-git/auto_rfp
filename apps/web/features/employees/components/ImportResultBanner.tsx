'use client';

import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { EmployeeImportRunItem, ImportFailureReason } from '@auto-rfp/core';

export interface ImportResultBannerProps {
  run: EmployeeImportRunItem;
  onDismiss: () => void;
}

/** Plain-language failure reasons (Q2 — no jargon in the report). */
const REASON_LABELS: Record<ImportFailureReason, string> = {
  UNREADABLE: "couldn't be read",
  INCOMPLETE_EXTRACTION: "didn't yield a person's name or valid details",
  EXTRACTION_FAILED: 'failed during AI processing',
  AMBIGUOUS_NAME: 'matches more than one existing employee — please resolve manually',
  UNMATCHED_PERSON: "names a person who isn't in the employee pool",
};

/**
 * Completion report for the latest import run (BR4.1, W2 step 1): counts plus
 * every failed document by name with its reason. Dismissible; a FAILED run is
 * reported with its partial progress preserved (BR4.2).
 */
export const ImportResultBanner = ({ run, onDismiss }: ImportResultBannerProps) => {
  const hasFailures = run.failedDocuments.length > 0;
  const isFailed = run.status === 'FAILED';

  const title = isFailed
    ? 'Employee import stopped early'
    : hasFailures
      ? 'Employee import finished with some problems'
      : 'Employee import finished';

  return (
    <Alert
      variant={isFailed ? 'destructive' : 'default'}
      data-testid="import-result-banner"
      className="relative"
    >
      {isFailed || hasFailures ? (
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      )}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p data-testid="import-result-counts">
          {run.documentsScanned} document{run.documentsScanned === 1 ? '' : 's'} scanned ·{' '}
          {run.cvsDetected} CV{run.cvsDetected === 1 ? '' : 's'} detected ·{' '}
          {run.employeesCreated} employee{run.employeesCreated === 1 ? '' : 's'} added ·{' '}
          {run.employeesUpdated} updated.
          {/* Older runs predate certificate mapping — hide the zero-valued segment for them. */}
          {(run.certificationDocsDetected ?? 0) > 0 &&
            ` ${run.certificationDocsDetected} certificate document${
              run.certificationDocsDetected === 1 ? '' : 's'
            } detected · ${run.certificationsMapped ?? 0} certification${
              (run.certificationsMapped ?? 0) === 1 ? '' : 's'
            } mapped to employees.`}
          {isFailed &&
            ' The AI service was unavailable, so the import could not finish. Everything imported so far has been kept — you can try again later.'}
        </p>
        {hasFailures && (
          <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="import-failed-documents">
            {run.failedDocuments.map((failure, index) => (
              <li key={`${failure.documentName}-${index}`} data-testid="import-failed-doc">
                <span className="font-medium">{failure.documentName}</span>{' '}
                {REASON_LABELS[failure.reason]}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-6 w-6"
        onClick={onDismiss}
        aria-label="Dismiss import report"
        data-testid="import-result-dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </Alert>
  );
};
