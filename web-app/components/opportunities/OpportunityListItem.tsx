'use client';

import React from 'react';
import type { OpportunityItem } from '@auto-rfp/shared';
import { Building2, CalendarClock, ExternalLink, Tag } from 'lucide-react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  item: OpportunityItem & Record<string, any>;
  onOpen?: (item: OpportunityItem) => void;
  className?: string;
};

const pick = (obj: any, keys: string[]) => keys.map((k) => obj?.[k]).find((v) => v != null && v !== '');

const formatDate = (v: any) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
};

export function OpportunityListItem({ item, onOpen, className }: Props) {
  const title = pick(item, ['title', 'name', 'opportunityTitle', 'noticeTitle']) ?? 'Untitled opportunity';
  const agency = pick(item, ['agency', 'organization', 'buyer', 'department']) ?? null;
  const source = pick(item, ['source', 'portal', 'platform']) ?? null;
  const due = pick(item, ['dueDate', 'responseDue', 'deadline', 'dueDateIso', 'dueAt', 'closeDate']) ?? null;
  const url = pick(item, ['url', 'link', 'noticeUrl']) ?? null;
  const status = pick(item, ['status', 'stage']) ?? null;

  const tags = (item as any)?.tags as string[] | undefined;

  return (
    <Card className={cn('hover:shadow-sm transition-shadow', className)}>
      <CardHeader className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium leading-5 truncate">{String(title)}</div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {agency && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5"/>
                  {String(agency)}
                </span>
              )}
              {source && (
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3.5 w-3.5"/>
                  {String(source)}
                </span>
              )}
              {due && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5"/>
                  Due: {formatDate(due)}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {status && <Badge variant="secondary">{String(status)}</Badge>}
              {Array.isArray(tags) &&
                tags.slice(0, 6).map((t) => (
                  <Badge key={t} variant="outline" className="font-normal">
                    {t}
                  </Badge>
                ))}
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {url && (
              <Button asChild variant="outline" size="sm" className="gap-2">
                <a href={String(url)} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4"/>
                  Open
                </a>
              </Button>
            )}
            {onOpen && (
              <Button variant="default" size="sm" onClick={() => onOpen(item)}>
                View
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {(item as any)?.summary && (
        <CardContent className="pt-0 pb-3">
          <p className="text-sm text-muted-foreground line-clamp-2">{String((item as any).summary)}</p>
        </CardContent>
      )}
    </Card>
  );
}