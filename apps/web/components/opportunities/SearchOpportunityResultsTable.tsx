'use client';

import { useEffect, useRef, useState } from 'react';
import type { SearchOpportunity } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  RotateCw,
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
  HIGHER_GOV: {
    label: 'HigherGov',
    color: 'bg-violet-50 text-violet-700 border-violet-200',
    icon: <FileText className="h-3 w-3" />,
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
  opportunities: SearchOpportunity[];
  isLoading: boolean;
  /**
   * A HigherGov saved-search fetch is still running in the background. The first
   * request returns immediately with `isLoading` false and no results while the
   * worker fetches, so without this the table would flash "No opportunities
   * found" mid-fetch. Keep showing the skeleton until results arrive.
   */
  isPending?: boolean;
  onImport: (id: string) => void;
  /**
   * Bulk import for the current selection. Optional so a caller that only wants
   * per-row import can omit it — the selection UI hides itself when absent.
   */
  onImportMany?: (ids: string[]) => Promise<void>;
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
  const [hasFailed, setHasFailed]     = useState(false);
  const [hasAttempted, setAttempted]  = useState(false);
  // A ref rather than state: it is set synchronously, so two callers firing in
  // the same tick can't both get past the guard and fetch twice.
  const loadedRef                     = useRef(false);

  const load = async () => {
    if (!orgId || !descriptionUrl || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    setHasFailed(false);
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
        // Definitive "there isn't one" — retrying would return the same answer.
        setDescription(null);
      } else {
        // 5xx and rate limiting are transient, so these are worth retrying.
        setHasFailed(true);
      }
    } catch {
      setHasFailed(true);
    } finally {
      setLoading(false);
      setAttempted(true);
    }
  };

  /** Clears the once-only guard so a failed fetch can be tried again. */
  const retry = () => {
    loadedRef.current = false;
    void load();
  };

  return { description, isLoading, hasFailed, hasAttempted, load, retry };
};

/**
 * Runs `onVisible` once, when the returned ref's element first scrolls into
 * view. Search pages render 25 results at a time and SAM.gov descriptions each
 * cost a request against a rate-limited key with no server-side cache, so they
 * are fetched for the cards actually reached rather than all of them up front.
 */
const useLoadWhenVisible = (enabled: boolean, onVisible: () => void) => {
  const ref = useRef<HTMLDivElement>(null);
  // Kept in a ref so re-renders don't tear down and recreate the observer.
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    // Older browsers (and any environment without the API) just load right away.
    if (typeof IntersectionObserver === 'undefined') {
      onVisibleRef.current();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          onVisibleRef.current();
        }
      },
      // Start slightly before the card is on screen so text is ready on arrival.
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
};

// ─── Description panel ───────────────────────────────────────────────────────

/**
 * HigherGov and DIBBS return plain text with `\n\n` paragraph breaks; SAM.gov's
 * lazily-fetched body is HTML. Sniffing the content handles both, and handles a
 * source sending the other format than expected.
 */
const looksLikeHtml = (s: string): boolean => /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?>/i.test(s);

/** Explicit allow-list, mirroring opportunity-item-card.tsx. */
const DESCRIPTION_SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'a', 'blockquote', 'code', 'pre', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
  FORCE_BODY: true,
};

const DescriptionBody = ({ description }: { description: string }) =>
  looksLikeHtml(description) ? (
    <div
      data-testid="description-html"
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
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(description, DESCRIPTION_SANITIZE_OPTIONS),
      }}
    />
  ) : (
    // React renders a string child as a text node, so this needs no sanitizing.
    // `whitespace-pre-line` keeps the paragraph breaks, and is scoped to this
    // branch — `white-space` inherits, so applying it to the HTML branch above
    // would double its `[&_p]:mb-2` paragraph spacing.
    <p
      data-testid="description-text"
      className="whitespace-pre-line text-xs text-muted-foreground leading-relaxed"
    >
      {description}
    </p>
  );

/**
 * Always-visible summary, for text that already came back on the search
 * response. Summaries run to ~5,000 characters, so it stays in a short scrolling
 * box by default — keeping a list of results scannable — and expands to full
 * height on demand. "Show more" appears only when the text actually overflows,
 * measured rather than derived from a hardcoded line height (this text is
 * `text-xs`, and the card's own width affects wrapping).
 */
const InlineDescription = ({ description }: { description: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    // Skip while expanded: the box is unbounded then, so it never reports
    // overflow and the control would vanish mid-read.
    if (!el || isExpanded) return;
    setCanExpand(el.scrollHeight > el.clientHeight + 1);
  }, [description, isExpanded]);

  return (
    <div className="mt-1 space-y-1">
      <div
        ref={scrollRef}
        data-testid="description-inline"
        className={cn('overscroll-contain pr-1', !isExpanded && 'max-h-24 overflow-y-auto')}
      >
        <DescriptionBody description={description} />
      </div>
      {(canExpand || isExpanded) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
          className="h-auto gap-1 p-0 has-[>svg]:px-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-primary"
        >
          {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {isExpanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
};

/**
 * Picks the right state for a card's summary: skeletons while a SAM.gov fetch is
 * in flight, a retry affordance if it failed, an explicit note when the source
 * has no description, or the text itself.
 */
const DescriptionSlot = ({
  description,
  isLoading,
  hasFailed,
  hasAttempted,
  onRetry,
}: {
  description: string | null;
  isLoading: boolean;
  hasFailed: boolean;
  hasAttempted: boolean;
  onRetry: () => void;
}) => {
  if (isLoading) {
    return (
      <div className="space-y-1.5" data-testid="description-loading">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    );
  }

  if (description) return <InlineDescription description={description} />;

  if (hasFailed) {
    return (
      <div className="flex items-center gap-2" data-testid="description-error">
        <p className="text-xs text-muted-foreground italic">Couldn&apos;t load description.</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-auto gap-1 p-0 has-[>svg]:px-0 text-xs font-normal text-primary hover:bg-transparent hover:underline"
        >
          <RotateCw className="size-3" />
          Retry
        </Button>
      </div>
    );
  }

  // Only after a fetch has actually resolved — otherwise every card without an
  // inline summary would claim "none" before its request even starts.
  if (hasAttempted) {
    return (
      <p className="text-xs text-muted-foreground italic" data-testid="description-empty">
        No description provided.
      </p>
    );
  }

  return null;
};

// ─── Opportunity card ─────────────────────────────────────────────────────────

const OpportunityCard = ({
  opp,
  onImport,
  importingId,
  orgId,
  isSelected,
  onToggleSelect,
}: {
  opp: SearchOpportunity;
  onImport: (id: string) => void;
  importingId: string | null;
  orgId?: string;
  /** Undefined when the caller passed no `onImportMany` — hides the checkbox. */
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) => {
  const src = SOURCE_CONFIG[opp.source] ?? SOURCE_CONFIG['MANUAL_UPLOAD']!;
  const urgency = getClosingUrgency(opp.closingDate);
  const isImporting = importingId === opp.id;
  const ref = opp.noticeId ?? opp.solicitationNumber;
  // SAM.gov sends a sam.gov URL in place of the description text, so it needs a
  // fetch. HigherGov and DIBBS already return the text inline on the search
  // response, so for those the hook no-ops (no orgId) and the inline text is used.
  const {
    description: fetchedDescription,
    isLoading: descLoading,
    hasFailed: descFailed,
    hasAttempted: descAttempted,
    load: loadDesc,
    retry: retryDesc,
  } = useSamDescription(
    opp.source === 'SAM_GOV' ? orgId : undefined,
    opp.descriptionUrl ?? null,
  );
  // DIBBS maps `o.description ?? null`, which does not collapse '' to null.
  const inlineDescription = opp.description?.trim() ? opp.description : null;
  const needsFetch = !inlineDescription && Boolean(opp.descriptionUrl);
  // Fetched once this card is nearly on screen, so every source ends up showing
  // its summary without a click.
  const cardRef = useLoadWhenVisible(needsFetch, loadDesc);
  const description = inlineDescription ?? fetchedDescription;

  return (
    <Card className="group hover:shadow-md transition-all duration-200 hover:border-primary/30">
      <CardContent className="p-4">
        {/* The visibility ref goes here rather than on <Card>: this is React 18
            and `Card` is a plain function component with no forwardRef, so a
            `ref` on it would be silently dropped. */}
        <div ref={cardRef} className="flex items-start gap-4">
          {/* Bulk-select */}
          {onToggleSelect && opp.id && (
            <Checkbox
              checked={!!isSelected}
              onCheckedChange={() => onToggleSelect(opp.id)}
              aria-label={`Select ${opp.title || 'opportunity'}`}
              className="mt-0.5 shrink-0"
            />
          )}

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

            {/* Summary — inline for HigherGov/DIBBS, fetched on approach for SAM.gov */}
            <DescriptionSlot
              description={description}
              isLoading={descLoading}
              hasFailed={descFailed}
              hasAttempted={descAttempted}
              onRetry={retryDesc}
            />

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
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const SearchOpportunityResultsTable = ({
  opportunities,
  isLoading,
  isPending,
  onImport,
  onImportMany,
  importingId,
  orgId,
}: SearchOpportunityResultsTableProps) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBulkImporting, setBulkImporting] = useState(false);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const importable = opportunities.filter((o) => !!o.id);
  const allSelected = importable.length > 0 && importable.every((o) => selected.has(o.id));

  const handleBulkImport = async () => {
    if (!onImportMany || selected.size === 0) return;
    setBulkImporting(true);
    try {
      // Preserve on-screen order rather than Set insertion order, so the progress
      // the user sees matches the list they are looking at.
      await onImportMany(importable.filter((o) => selected.has(o.id)).map((o) => o.id));
      setSelected(new Set());
    } finally {
      setBulkImporting(false);
    }
  };

  if (isLoading) return <LoadingSkeleton />;
  // A HigherGov background fetch with nothing yet — keep the skeleton up rather
  // than flashing "No opportunities found" while results are still on the way.
  if (!opportunities.length && isPending) return <LoadingSkeleton />;
  if (!opportunities.length) return <EmptyState />;

  return (
    <div className="space-y-3">
      {onImportMany && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() =>
              setSelected(allSelected ? new Set() : new Set(importable.map((o) => o.id)))
            }
            aria-label="Select all results"
          />
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
          </span>
          {selected.size > 0 && (
            <Button
              size="sm"
              className="ml-auto h-8"
              onClick={handleBulkImport}
              disabled={isBulkImporting}
            >
              {isBulkImporting ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Importing {selected.size}…</>
              ) : (
                <><Download className="mr-1.5 h-3.5 w-3.5" />Import {selected.size} selected</>
              )}
            </Button>
          )}
        </div>
      )}

      {opportunities.map((opp, idx) => (
        <OpportunityCard
          key={`${opp.source}-${opp.id}-${idx}`}
          opp={opp}
          onImport={onImport}
          importingId={importingId}
          orgId={orgId}
          isSelected={selected.has(opp.id)}
          onToggleSelect={onImportMany ? toggle : undefined}
        />
      ))}
    </div>
  );
};
