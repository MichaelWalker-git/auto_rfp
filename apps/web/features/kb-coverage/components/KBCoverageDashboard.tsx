'use client';

import {
  KB_COVERAGE_CATEGORIES,
  KB_COVERAGE_CATEGORY_KEYS,
  KB_COVERAGE_GATED_DOCUMENT_TYPES,
  RFP_DOCUMENT_TYPES,
  formatMissingCoverageCategories,
} from '@auto-rfp/core';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useKBCoverage } from '../hooks/useKBCoverage';

const documentTypeLabel = (documentType: string): string =>
  RFP_DOCUMENT_TYPES[documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? documentType;

/**
 * The KB owner's single view of every coverage gap in the org. Derived from the
 * same probe the generation gate uses, so it can't drift from what actually
 * blocks generation.
 */
export const KBCoverageDashboard = ({ orgId }: { orgId: string }) => {
  const { snapshot, isGateEnabled, isLoading, error, getStatus, hasVerdict } =
    useKBCoverage(orgId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // `error` and a settled-but-bodiless response are the same thing to a KB owner:
  // no verdict. Reporting "every type is covered" from an absent answer is the one
  // failure this view must not have — it is the only place the gap is surfaced, so
  // there is no second signal to catch it.
  if (error || !hasVerdict) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          Could not load KB coverage{error ? `: ${error.message}` : '.'} Coverage is unknown —
          this is not a report that the knowledge base is complete.
        </CardContent>
      </Card>
    );
  }

  const gapCount = KB_COVERAGE_GATED_DOCUMENT_TYPES.filter(
    (documentType) => !getStatus(documentType).covered,
  ).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Knowledge base categories</CardTitle>
          <CardDescription>
            What the knowledge base holds today. A category counts as present when at least one
            non-archived item is filed under it — this checks that content exists, not that it is
            complete or current.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {KB_COVERAGE_CATEGORY_KEYS.map((key) => {
            const status = snapshot[key];
            const present = !!status?.present;
            return (
              <Badge
                key={key}
                variant="outline"
                className={`gap-1 ${
                  present ? 'border-emerald-200 text-emerald-700' : 'border-amber-300 text-amber-700'
                }`}
              >
                {present ? (
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                )}
                {KB_COVERAGE_CATEGORIES[key].label}
                {present ? ` (${status?.count ?? 0})` : ' — none'}
              </Badge>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Document types with knowledge base requirements
          </CardTitle>
          <CardDescription>
            {/* The gate-mode sentence is only meaningful when there is a gap for it
                to describe — appending it to "everything is covered" left the page
                warning about gaps it had just said do not exist. */}
            {gapCount === 0 ? (
              'Every document type with knowledge base requirements is covered.'
            ) : (
              <>
                {gapCount} document type{gapCount === 1 ? '' : 's'} cannot be fully grounded
                yet.{' '}
                {isGateEnabled
                  ? 'Generation is blocked for uncovered types in this organization.'
                  : 'Gaps are shown as warnings only — generation is not blocked in this organization.'}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Missing from the knowledge base</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KB_COVERAGE_GATED_DOCUMENT_TYPES.map((documentType) => {
                const { covered, missing } = getStatus(documentType);
                return (
                  <TableRow key={documentType}>
                    <TableCell className="font-medium">
                      {documentTypeLabel(documentType)}
                    </TableCell>
                    <TableCell>
                      {covered ? (
                        <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                          Covered
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={
                            isGateEnabled
                              ? 'border-destructive text-destructive'
                              : 'border-amber-300 text-amber-700'
                          }
                        >
                          {isGateEnabled ? 'Blocked' : 'Gap'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {covered ? '—' : formatMissingCoverageCategories(missing)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
