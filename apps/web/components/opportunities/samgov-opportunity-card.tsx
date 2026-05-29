'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  BadgeCheck,
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  FileText,
  Hash,
  Paperclip,
  Tag,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import DOMPurify from 'dompurify';

import type { SamOpportunitySlim } from '@auto-rfp/core';
import type { SamGovDescriptionResponse } from '@/lib/hooks/use-opportunities';
import { fmtDate } from './samgov-utils';

type SamGovOpportunityCardProps = {
  opportunity: SamOpportunitySlim;
  description: SamGovDescriptionResponse | null;
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
  description,
  isLoadingDescription,
  onViewDescription,
  onImportSolicitation,
  isImporting,
}: SamGovOpportunityCardProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const isActive = o.active === 'Yes' || (o.active as any) === true;

  const title = o.title ?? '(No title)';
  const noticeId = o.noticeId ?? '—';
  const sol = o.solicitationNumber ?? '—';
  const attachmentsCount = o.attachmentsCount ?? 0;
  const posted = fmtDate(o.postedDate) || '—';
  const due = fmtDate(o.responseDeadLine) || '—';

  const sanitizeHtml = (html: string) => {
    return DOMPurify.sanitize(html);
  };

  const handleToggleDescription = () => {
    if (!isOpen && !description) {
      // Load description if not already loaded
      onViewDescription(o);
    }
    // Always toggle the state
    setIsOpen(!isOpen);
  };

  // Auto-open when description loads for the first time
  React.useEffect(() => {
    if (description && !isOpen) {
      setIsOpen(true);
    }
  }, [description]); // Removed isOpen from dependencies to only trigger on description load

  return (
    <Card
      key={o.noticeId ?? `${o.solicitationNumber}-${o.postedDate}-${o.title}`}
      className="group rounded-2xl border bg-background transition-all hover:shadow-md overflow-hidden"
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
        </div>

        {o.description && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-4">
            <CollapsibleTrigger
              onClick={handleToggleDescription}
              disabled={isLoadingDescription}
              className="group/trigger flex w-full items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-sm font-medium transition-all hover:bg-muted/40 hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={isOpen ? 'Hide description' : 'View description'}
            >
              <span className="flex items-center gap-2">
                {isLoadingDescription ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading description...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {isOpen ? 'Description' : 'View full description'}
                  </>
                )}
              </span>
              {!isLoadingDescription && (
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
              )}
            </CollapsibleTrigger>

            <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2">
              <div className="mt-3 rounded-lg border border-border/50 bg-background p-5 shadow-sm">
                {description?.description ? (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:font-semibold prose-ul:my-2 prose-li:my-1"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(description.description) }}
                  />
                ) : isLoadingDescription ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading description...
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">No description available</div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

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