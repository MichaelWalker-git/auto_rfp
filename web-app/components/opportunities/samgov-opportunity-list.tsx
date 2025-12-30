'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Calendar, ExternalLink, Loader2, Search } from 'lucide-react';

import type { SamOpportunitySlim, LoadSamOpportunitiesRequest } from '@auto-rfp/shared';
import { fmtDate, safeUrl } from './samgov-utils';

type Props = {
  data?: {
    opportunities: SamOpportunitySlim[];
    totalRecords: number;
    limit: number;
    offset: number;
  } | null;
  isLoading: boolean;

  // for pagination:
  onPage: (offset: number) => Promise<void>;
  onImportSolicitation: (data: SamOpportunitySlim) => void;
};

export function SamGovOpportunityList({ data, isLoading, onPage, onImportSolicitation }: Props) {
  const { toast } = useToast();

  const results = data?.opportunities ?? [];
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 25;
  const total = data?.totalRecords ?? 0;

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="space-y-3">
      {isLoading && !data && (
        <div className="flex items-center justify-center rounded-xl border py-12">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Searching SAM.gov…
          </div>
        </div>
      )}

      {data && results.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
          <Search className="h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No matches</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try expanding your date range or adjusting NAICS/keywords.
          </p>
        </div>
      )}

      {results.map((o) => {
        const link = safeUrl(o.description);
        const isActive = o.active === 'Yes' || (o.active as any) === true;

        return (
          <Card
            key={o.noticeId ?? `${o.solicitationNumber}-${o.postedDate}-${o.title}`}
            className="rounded-2xl transition-shadow hover:shadow-md"
          >
            <CardContent className="p-4 md:p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{o.title ?? '(No title)'}</h3>
                    {isActive && <Badge className="shrink-0">Active</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Notice: {o.noticeId ?? '—'}</span>
                    <span>•</span>
                    <span>Sol: {o.solicitationNumber ?? '—'}</span>
                  </div>
                </div>

                {link && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0"
                  >
                    View <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Posted:</span>
                  <span className="font-medium">{fmtDate(o.postedDate) || '—'}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-destructive" />
                  <span className="text-muted-foreground">Due:</span>
                  <span className="font-medium">{fmtDate(o.responseDeadLine) || '—'}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">NAICS:</span>
                  <Badge variant="outline">{o.naicsCode ?? '—'}</Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">PSC:</span>
                  <Badge variant="outline">{o.classificationCode ?? '—'}</Badge>
                </div>

                {(o.setAsideCode || o.setAside) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Set-aside:</span>
                    <Badge variant="secondary">{o.setAsideCode ?? o.setAside}</Badge>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-3 border-t sm:flex-row sm:items-center">
                <Button
                  size="sm"
                  onClick={() => onImportSolicitation(o)}
                >
                  Import solicitation
                </Button>
                <div className="text-xs text-muted-foreground sm:ml-auto">
                  Saved searches + alerts next.
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {data && total > limit && (
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <Button variant="outline" disabled={!canPrev || isLoading} onClick={() => onPage(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <div className="text-sm text-muted-foreground">
            Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))}
          </div>
          <Button variant="outline" disabled={!canNext || isLoading} onClick={() => onPage(offset + limit)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
