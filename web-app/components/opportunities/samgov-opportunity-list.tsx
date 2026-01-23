'use client';

import * as React from 'react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BadgeCheck, Building2, Calendar, Hash, Loader2, Paperclip, Search, Tag, } from 'lucide-react';

import type { SamOpportunitySlim } from '@auto-rfp/shared';
import { useSamGovDescription, type SamGovDescriptionResponse } from '@/lib/hooks/use-opportunities';
import { fmtDate } from './samgov-utils';
import { useToast } from '../ui/use-toast';
import DOMPurify from 'dompurify';

type Props = {
  data?: {
    opportunities: SamOpportunitySlim[];
    totalRecords: number;
    limit: number;
    offset: number;
  } | null;
  isLoading: boolean;

  onPage: (offset: number) => Promise<void>;
  onImportSolicitation: (data: SamOpportunitySlim) => void;
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
        <div className={['truncate text-sm font-medium', tone === 'danger' ? 'text-destructive' : ''].join(' ')}>
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

export function SamGovOpportunityList({ data, isLoading, onPage, onImportSolicitation }: Props) {
  const results = data?.opportunities ?? [];
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 25;
  const total = data?.totalRecords ?? 0;

  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  const [selectedDescription, setSelectedDescription] = useState<SamGovDescriptionResponse | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<SamOpportunitySlim | null>(null);

  const { trigger: fetchDescription, isMutating } = useSamGovDescription();
  const { toast } = useToast();

  const handleViewDescription = async (opportunity: SamOpportunitySlim) => {
    // Defensive null check - fixes AUTO-RFP-5N
    if (!opportunity) {
      console.error('Opportunity is null');
      toast({
        title: 'Error',
        description: 'Invalid opportunity data.',
        variant: 'destructive',
      });
      return;
    }
    setSelectedOpportunity(opportunity)
    if (!opportunity.description) {
      console.error('No description URL available');
      toast({
        title: 'No description available',
        description: 'No description is available for this opportunity.',
        variant: 'destructive',
      });
      setSelectedOpportunity(null)
      return;
    }

    try {
      const data = await fetchDescription({ descriptionUrl: opportunity.description });
      setSelectedDescription(data);
    } catch (error) {
      console.error('Failed to load description:', error);
      toast({
          title: 'Error',
          description: 'Failed to fetch opportunity description',
          variant: 'destructive',
        });
    }
  };

  const sanitizeHtml = (description: string) => {
    return DOMPurify.sanitize(description);
  };

  return (
    <div className="space-y-3">
      {isLoading && !data && (
        <div className="flex items-center justify-center rounded-2xl border bg-muted/20 py-14">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin"/>
            Searching SAM.gov…
          </div>
        </div>
      )}

      {data && results.length === 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/10 py-14 text-center">
          <Search className="h-10 w-10 text-muted-foreground/50"/>
          <p className="mt-3 text-sm font-medium">No matches</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try expanding your date range or adjusting NAICS/keywords.
          </p>
        </div>
      )}

      {results.map((o) => {
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
            className="group rounded-2xl border bg-background transition-all hover:-translate-y-[1px] hover:shadow-md"
          >
            <CardContent className="p-4 md:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{title}</h3>

                    {isActive ? (
                      <Badge className="gap-1">
                        <BadgeCheck className="h-3.5 w-3.5"/>
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}

                    {(o.setAsideCode || o.setAside) && (
                      <Badge variant="outline" className="gap-1">
                        <Tag className="h-3.5 w-3.5"/>
                        {o.setAsideCode ?? o.setAside}
                      </Badge>
                    )}

                    <Badge
                      variant={attachmentsCount === 0 ? 'destructive' : 'default'}
                      className="gap-1 rounded-xl"
                      title={attachmentsCount === 0 ? 'No attachments available - may require manual download' : `${attachmentsCount} attachment${attachmentsCount === 1 ? '' : 's'} available`}
                    >
                      <Paperclip className="h-3.5 w-3.5"/>
                      {attachmentsCount === 0 ? 'No files' : attachmentsCount}
                    </Badge>
                  </div>

                  <div className="mt-2 grid gap-1.5">
                    <MetaRow icon={<Hash className="h-3.5 w-3.5"/>} label="Notice:">
                      {noticeId}
                    </MetaRow>

                    <MetaRow icon={<Building2 className="h-3.5 w-3.5"/>} label="Solicitation:">
                      {sol}
                    </MetaRow>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 md:w-[320px]">
                  <StatPill
                    icon={<Calendar className="h-4 w-4 text-muted-foreground"/>}
                    label="Posted"
                    value={posted}
                  />
                  <StatPill icon={<Calendar className="h-4 w-4 text-destructive"/>} label="Due" value={due}
                            tone="danger"/>
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
                  size='sm' 
                  variant={o.description ? 'default' : 'ghost'}
                  onClick={() => handleViewDescription(o)}
                  disabled={isMutating}
                >
                  {isMutating && o.solicitationNumber === selectedOpportunity?.solicitationNumber ? 'Loading...' : 'View description'}
                </Button>
              </div>

              {o.solicitationNumber === selectedOpportunity?.solicitationNumber && 
                <Dialog open={!!selectedDescription} onOpenChange={() => {
                  setSelectedDescription(null)
                  setSelectedOpportunity(null)
                }}>
                  <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Opportunity Description for {title}</DialogTitle>
                    </DialogHeader>
                    
                      {selectedDescription?.description && 
                        <div dangerouslySetInnerHTML={{__html: sanitizeHtml(selectedDescription.description)}}></div>
                      }
                      {!selectedDescription?.description && <div>Loading...</div>}
                      
                    
                  </DialogContent>
                </Dialog>
              }

              <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => onImportSolicitation(o)} disabled={isLoading}>
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
      })}

      {data && total > limit && (
        <div className="mt-4 flex items-center justify-between rounded-2xl border bg-muted/10 p-3">
          <Button variant="outline" disabled={!canPrev || isLoading}
                  onClick={() => onPage(Math.max(0, offset - limit))}>
            Previous
          </Button>

          <div className="text-sm text-muted-foreground">
            Page <span className="text-foreground">{Math.floor(offset / limit) + 1}</span> of{' '}
            <span className="text-foreground">{Math.max(1, Math.ceil(total / limit))}</span>
          </div>

          <Button variant="outline" disabled={!canNext || isLoading} onClick={() => onPage(offset + limit)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}