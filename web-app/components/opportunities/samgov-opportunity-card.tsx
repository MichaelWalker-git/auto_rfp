'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  BadgeCheck,
  Building2,
  Calendar,
  Hash,
  Paperclip,
  Tag,
} from 'lucide-react';

import type { SamOpportunitySlim } from '@auto-rfp/shared';
import { fmtDate } from './samgov-utils';

type SamGovOpportunityCardProps = {
  opportunity: SamOpportunitySlim;
  isLoadingDescription: boolean;
  onViewDescription: (opportunity: SamOpportunitySlim) => void;
  onImportSolicitation: (opportunity: SamOpportunitySlim) => void;
  isImporting: boolean;
};

function StatPill({
  icon,
  label,
  value,
  tone = 'muted',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] leading-4 text-muted-foreground">{label}</div>
        <div
          className={['truncate text-sm font-medium', tone === 'danger' ? 'text-destructive' : ''].join(
            ' '
          )}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        {icon}
        <span>{label}</span>
      </span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}

export function SamGovOpportunityCard({
  opportunity: o,
  isLoadingDescription,
  onViewDescription,
  onImportSolicitation,
  isImporting,
}: SamGovOpportunityCardProps) {
  const isActive = o.active === 'Yes' || (o.active as any) === true;

  const title = o.title ?? '(No title)';
  const noticeId = o.noticeId ?? '—';
  const sol = o.solicitationNumber ?? '—';
  const attachmentsCount = o.attachmentsCount ?? 0;
  const posted = fmtDate(o.postedDate) || '—';
  const due = fmtDate(o.responseDeadLine) || '—';

  return (
    <Card
      key={o.noticeId ?? `${o.solicitationNumber}-${o.postedDate}-${o.title}`}
      className="group rounded-2xl border bg-background transition-all hover:shadow-md"
    >
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
                {title}
              </h3>

              {isActive ? (
                <Badge className="gap-1">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}

              {(o.setAsideCode || o.setAside) && (
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-3.5 w-3.5" />
                  {o.setAsideCode ?? o.setAside}
                </Badge>
              )}

              <Badge
                variant={attachmentsCount === 0 ? 'destructive' : 'default'}
                className="gap-1 rounded-xl"
                title={
                  attachmentsCount === 0
                    ? 'No attachments available - may require manual download'
                    : `${attachmentsCount} attachment${attachmentsCount === 1 ? '' : 's'} available`
                }
              >
                <Paperclip className="h-3.5 w-3.5" />
                {attachmentsCount === 0 ? 'No files' : attachmentsCount}
              </Badge>
            </div>

            <div className="mt-2 grid gap-1.5">
              <MetaRow icon={<Hash className="h-3.5 w-3.5" />} label="Notice:">
                {noticeId}
              </MetaRow>

              <MetaRow icon={<Building2 className="h-3.5 w-3.5" />} label="Solicitation:">
                {sol}
              </MetaRow>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:w-[320px]">
            <StatPill
              icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
              label="Posted"
              value={posted}
            />
            <StatPill
              icon={<Calendar className="h-4 w-4 text-destructive" />}
              label="Due"
              value={due}
              tone="danger"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-xl">
              NAICS: <span className="ml-1 font-medium text-foreground">{o.naicsCode ?? '—'}</span>
            </Badge>
            <Badge variant="secondary" className="rounded-xl">
              PSC: <span className="ml-1 font-medium text-foreground">{o.classificationCode ?? '—'}</span>
            </Badge>
          </div>
          <Button
            size="sm"
            variant={o.description ? 'default' : 'ghost'}
            onClick={() => onViewDescription(o)}
            disabled={isLoadingDescription}
          >
            {isLoadingDescription ? 'Loading...' : 'View description'}
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => onImportSolicitation(o)} disabled={isImporting}>
              Import solicitation
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {o.type ? (
              <span className="inline-flex items-center gap-1">
                Type: <span className="text-foreground/80">{String(o.type)}</span>
              </span>
            ) : (
              <span className="opacity-80"> </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}