'use client';

import { useState } from 'react';
import type { SearchOpportunitySlim } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Shield,
  Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import DOMPurify from 'dompurify';

// ─── Source config ────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  SAM_GOV: {
    label: 'SAM.gov',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: <FileText className="h-3 w-3" />,
  },
  DIBBS: {
    label: 'DIBBS',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: <Shield className="h-3 w-3" />,
  },
  MANUAL_UPLOAD: {
    label: 'Manual',
    color: 'bg-slate-50 text-slate-600 border-slate-200',
    icon: <Download className="h-3 w-3" />,
  },
};

// ─── Closing date urgency ─────────────────────────────────────────────────────

const getClosingUrgency = (closingDate: string | null): { label: string; color: string } | null => {
  if (!closingDate) return null;
  const d = new Date(closingDate);
  if (isNaN(d.getTime())) return null;
  const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0)  return { label: 'Closed',       color: 'text-slate-400' };
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, color: 'text-red-600 font-semibold' };
  if (daysLeft <= 7) return { label: `${daysLeft}d left`, color: 'text-orange-500 font-medium' };
  if (daysLeft <= 14) return { label: `${daysLeft}d left`, color: 'text-yellow-600' };
  return null;
};

const formatDate = (s: string | null): string => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface SearchOpportunityResultsTableProps {
  opportunities: SearchOpportunitySlim[];
  isLoading: boolean;
  onImport: (id: string) => void;
  importingId: string | null;
  orgId?: string;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

const LoadingSkeleton = () => (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <Card key={i} className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-8 w-20 shrink-0" />
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="rounded-full bg-muted p-4 mb-4">
      <FileText className="h-8 w-8 text-muted-foreground" />
    </div>
    <h3 className="text-base font-medium mb-1">No opportunities found</h3>
    <p className="text-sm text-muted-foreground max-w-sm">
      Try adjusting your keywords, date range, or filters. You can also search without any filters to browse all recent opportunities.
    </p>
  </div>
);

// ─── SAM.gov description loader ──────────────────────────────────────────────

const useSamDescription = (orgId: string | undefined, descriptionUrl: string | null) => {
  const [description, setDescription] = useState<string | null>(null);
  const [isLoading, setLoading]       = useState(false);
  const [loaded, setLoaded]           = useState(false);

  const load = async () => {
    if (!orgId || !descriptionUrl || loaded) return;
    setLoading(true);
    try {
      const res = await authFetcher(
        `${env.BASE_API_URL}/search-opportunities/opportunity-description?orgId=${encodeURIComponent(orgId)}`,
        {
          method: 'POST',
          body: JSON.stringify({ descriptionUrl }),
        },
      );
      if (res.ok) {
        const data = await res.json() as { description?: string; content?: string; opportunityDescription?: string };
        setDescription(data.description ?? data.content ?? data.opportunityDescription ?? null);
      } else if (res.status === 404 || res.status === 400) {
        setDescription(null);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  return { description, isLoading, load, loaded };
};

// ─── Description panel ───────────────────────────────────────────────────────

const DescriptionPanel = ({
  description,
  isLoading,
}: {
  description: string | null;
  isLoading: boolean;
}) => (
  <div className="mt-3 pt-3 border-t">
    {isLoading ? (
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    ) : description ? (
      <div
        className={cn(
          'prose prose-xs max-w-none text-xs text-muted-foreground leading-relaxed',
          '[&_p]:mb-2 [&_p:last-child]:mb-0',
          '[&_ul]:mb-2 [&_ul]:pl-4 [&_li]:list-disc [&_li]:mb-0.5',
          '[&_ol]:mb-2 [&_ol]:pl-4 [&_ol>li]:list-decimal',
          '[&_strong]:font-semibold [&_strong]:text-foreground',
          '[&_u]:underline',
          '[&_h1]:text-sm [&_h1]:font-semibold [&_h1]:mb-1',
          '[&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mb-1',
          '[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-1',
          '[&_a]:text-primary [&_a]:underline [&_a]:hover:opacity-80',
          '[&_br]:block',
        )}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(description) }}
      />
    ) : (
      <p className="text-xs text-muted-foreground italic">No description available.</p>
    )}
  </div>
);

// ─── Opportunity card ─────────────────────────────────────────────────────────

const OpportunityCard = ({
  opp,
  onImport,
  importingId,
  orgId,
}: {
  opp: SearchOpportunitySlim;
  onImport: (id: string) => void;
  importingId: string | null;
  orgId?: string;
}) => {
  const src = SOURCE_CONFIG[opp.source] ?? SOURCE_CONFIG['MANUAL_UPLOAD']!;
  const urgency = getClosingUrgency(opp.closingDate);
  const isImporting = importingId === opp.id;
  const ref = opp.noticeId ?? opp.solicitationNumber;
  const [expanded, setExpanded] = useState(false);
  const { description, isLoading: descLoading, load: loadDesc } = useSamDescription(
    opp.source === 'SAM_GOV' ? orgId : undefined,
    opp.descriptionUrl ?? null,
  );

  const handleToggleDescription = () => {
    if (!expanded) loadDesc();
    setExpanded((v) => !v);
  };

  return (
    <Card className="group hover:shadow-md transition-all duration-200 hover:border-primary/30">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Title + source badge */}
            <div className="flex items-start gap-2 flex-wrap">
              <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium shrink-0', src.color)}>
                {src.icon}
                {src.label}
              </span>
              <h3 className="text-sm font-medium leading-snug line-clamp-2 flex-1">
                {opp.title || 'Untitled Opportunity'}
              </h3>
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {opp.organizationName && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[200px]">{opp.organizationName}</span>
                </span>
              )}
              {ref && (
                <span className="flex items-center gap-1 font-mono">
                  <Tag className="h-3 w-3 shrink-0" />
                  {ref}
                </span>
              )}
              {opp.closingDate && (
                <span className={cn('flex items-center gap-1', urgency?.color ?? '')}>
                  <Calendar className="h-3 w-3 shrink-0" />
                  Closes {formatDate(opp.closingDate)}
                  {urgency && urgency.label !== 'Closed' && (
                    <span className="ml-1">({urgency.label})</span>
                  )}
                </span>
              )}
            </div>

            {/* Tags row */}
            <div className="flex flex-wrap gap-1.5">
              {opp.contractVehicle && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">
                  {opp.contractVehicle}
                </Badge>
              )}
              {opp.setAside && (
                <Badge variant="outline" className="text-xs h-5 px-1.5">
                  {opp.setAside}
                </Badge>
              )}
              {opp.naicsCode && (
                <Badge variant="outline" className="text-xs h-5 px-1.5 text-muted-foreground">
                  NAICS {opp.naicsCode}
                </Badge>
              )}
              {opp.technologyArea && (
                <Badge variant="outline" className="text-xs h-5 px-1.5 bg-purple-50 text-purple-700 border-purple-200">
                  {opp.technologyArea}
                </Badge>
              )}
              {opp.attachmentsCount > 0 && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {opp.attachmentsCount} attachment{opp.attachmentsCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <Button
              size="sm"
              disabled={!opp.id || isImporting}
              onClick={() => opp.id && onImport(opp.id)}
              className="min-w-[90px]"
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Import
                </>
              )}
            </Button>
            {opp.url && (
              <a
                href={opp.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                View source
              </a>
            )}
            {/* SAM.gov description toggle */}
            {opp.source === 'SAM_GOV' && opp.noticeId && (
              <button
                onClick={handleToggleDescription}
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? 'Hide' : 'Description'}
              </button>
            )}
          </div>
        </div>

        {/* Expandable description */}
        {expanded && (
          <DescriptionPanel
            description={description}
            isLoading={descLoading}
          />
        )}
      </CardContent>
    </Card>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const SearchOpportunityResultsTable = ({
  opportunities,
  isLoading,
  onImport,
  importingId,
  orgId,
}: SearchOpportunityResultsTableProps) => {
  if (isLoading) return <LoadingSkeleton />;
  if (!opportunities.length) return <EmptyState />;

  return (
    <div className="space-y-3">
      {opportunities.map((opp, idx) => (
        <OpportunityCard
          key={opp.id || idx}
          opp={opp}
          onImport={onImport}
          importingId={importingId}
          orgId={orgId}
        />
      ))}
    </div>
  );
};
