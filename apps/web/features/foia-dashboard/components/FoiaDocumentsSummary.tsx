'use client';

import Link from 'next/link';
import { FileText, Lock, Mail, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/components/permission-wrapper';
import { FOIA_RESPONSE_OUTCOME_LABELS } from '@auto-rfp/core';
import type { FoiaDashboardResponse, FoiaResponseOutcome } from '@auto-rfp/core';

interface FoiaDocumentsSummaryProps {
  orgId: string;
  dashboard: FoiaDashboardResponse | undefined;
  isLoading: boolean;
}

/**
 * Request volume, what agencies replied, and the released-document count.
 *
 * The COUNT of documents is open to every role — it is an aggregate and reveals
 * nothing about their contents. Opening a document is gated on `foia:documents:read`
 * (ADMIN only), because released records routinely contain a competitor's pricing and
 * evaluators by name.
 *
 * Deliberately NOT gated on `foia:send`: that is the authority to transmit a request,
 * a different question, and reusing it would admit every EDITOR to the documents.
 */
export const FoiaDocumentsSummary = ({
  orgId,
  dashboard,
  isLoading,
}: FoiaDocumentsSummaryProps) => {
  const canReadDocuments = usePermission('foia:documents:read');

  const outcomes = Object.entries(dashboard?.responseOutcomeCounts ?? {}).filter(
    ([, count]) => typeof count === 'number' && count > 0,
  ) as Array<[FoiaResponseOutcome, number]>;

  return (
    <Card className="border">
      <CardHeader>
        <CardTitle className="text-base">Requests &amp; Released Records</CardTitle>
        <CardDescription>What we asked for, and what came back</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Send className="h-3.5 w-3.5" />
                  Requests sent
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {dashboard?.sentCount ?? 0}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  Documents released
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {dashboard?.documentCount ?? 0}
                </p>
              </div>
            </div>

            {outcomes.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  Agency replies
                </p>
                {outcomes.map(([outcome, count]) => (
                  <div key={outcome} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {FOIA_RESPONSE_OUTCOME_LABELS[outcome] ?? outcome}
                    </span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t pt-3 text-xs">
              {canReadDocuments ? (
                <p className="text-muted-foreground">
                  Released records are attached to the opportunity they belong to.{' '}
                  <Link
                    href={`/organizations/${orgId}/opportunities`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Browse opportunities
                  </Link>
                  .
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Released records can name competitors&apos; pricing and individual
                    evaluators, so opening them is limited to administrators.
                  </span>
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
