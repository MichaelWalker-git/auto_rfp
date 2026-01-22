'use client';

import React, { useMemo } from 'react';
import type { OpportunityItem } from '@auto-rfp/shared';
import { Building2, CalendarClock, FileText, Hash, Tag } from 'lucide-react';

import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  item: OpportunityItem;
  onOpen?: (item: OpportunityItem) => void;
  className?: string;
};

const fmt = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

export function OpportunitiesListItem({ item, onOpen, className }: Props) {
  const posted = useMemo(() => fmt(item.postedDateIso), [item.postedDateIso]);
  const due = useMemo(() => fmt(item.responseDeadlineIso), [item.responseDeadlineIso]);

  return (
    <Card className={cn('hover:bg-muted/40 transition-colors', className)}>
      <CardHeader className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h3 className="text-sm font-semibold leading-5 truncate">{item.title}</h3>

              <Badge variant="secondary" className="shrink-0">
                {item.source}
              </Badge>

              {item.active ? (
                <Badge className="shrink-0">ACTIVE</Badge>
              ) : (
                <Badge variant="outline" className="shrink-0">
                  INACTIVE
                </Badge>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {item.organizationName ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="truncate max-w-[520px]">{item.organizationName}</span>
                </span>
              ) : null}

              {posted ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  <span>Posted: {posted}</span>
                </span>
              ) : null}

              {due ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  <span>Due: {due}</span>
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {item.type ? <Badge variant="outline">{item.type}</Badge> : null}

              {item.naicsCode ? (
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-3.5 w-3.5" />
                  NAICS {item.naicsCode}
                </Badge>
              ) : null}

              {item.pscCode ? (
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-3.5 w-3.5" />
                  PSC {item.pscCode}
                </Badge>
              ) : null}

              {item.setAside ? <Badge variant="outline">{item.setAside}</Badge> : null}

              {item.solicitationNumber ? (
                <Badge variant="outline" className="gap-1">
                  <Hash className="h-3.5 w-3.5" />
                  {item.solicitationNumber}
                </Badge>
              ) : null}

              {item.noticeId ? (
                <Badge variant="outline" className="gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {item.noticeId}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 flex items-center">
            <Button size="sm" onClick={() => onOpen?.(item)}>
              Open
            </Button>
          </div>
        </div>
      </CardHeader>

      {item.description ? (
        <CardContent className="px-4 pb-4 pt-0">
          <p className="text-xs text-muted-foreground line-clamp-3">{item.description}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}