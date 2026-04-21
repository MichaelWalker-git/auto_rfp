'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Bookmark, Layers, Loader2, Search } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { SearchOpportunityForm, type FormValues } from './SearchOpportunityForm';
import { buildImportBody } from './build-import-body';
import { SearchOpportunityResultsTable } from './SearchOpportunityResultsTable';
import { useSearchOpportunities } from '@/lib/hooks/use-search-opportunities';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { SearchOpportunityCriteria } from '@/lib/hooks/use-search-opportunities';
import type { DuplicateInfo } from '@/lib/hooks/use-import-solicitation';
import { DuplicateSolicitationDialog } from '@/components/samgov/duplicate-solicitation-dialog';
import { HigherGovFavoritesBanner } from './HigherGovFavoritesBanner';

// ─── URL ↔ criteria helpers ─────────────────────────────────────────────────

const criteriaToParams = (c: SearchOpportunityCriteria): URLSearchParams => {
  const p = new URLSearchParams();
  if (c.keywords)            p.set('q', c.keywords);
  if (c.sources?.length)     p.set('source', c.sources[0]);
  if (c.naics?.length)       p.set('naics', c.naics.join(','));
  if (c.setAsideCode)        p.set('setAside', c.setAsideCode);
  if (c.postedFrom)          p.set('from', c.postedFrom);
  if (c.postedTo)            p.set('to', c.postedTo);
  if (c.closingFrom)         p.set('closingFrom', c.closingFrom);
  if (c.closingTo)           p.set('closingTo', c.closingTo);
  if (c.higherGovSourceType) p.set('hgSource', c.higherGovSourceType);
  return p;
};

const paramsToFormValues = (p: URLSearchParams): Partial<FormValues> | null => {
  if (!p.has('q') && !p.has('source') && !p.has('naics') && !p.has('setAside') && !p.has('from')) return null;
  const parseDate = (s: string | null) => s ? new Date(s) : undefined;
  return {
    keywords: p.get('q') ?? '',
    source: (p.get('source') as FormValues['source']) ?? 'all',
    naics: p.get('naics')?.split(',').filter(Boolean) ?? [],
    setAsideCode: p.get('setAside') ?? '',
    postedFrom: parseDate(p.get('from')),
    postedTo: parseDate(p.get('to')),
    closingFrom: parseDate(p.get('closingFrom')),
    closingTo: parseDate(p.get('closingTo')),
    higherGovSourceType: (p.get('hgSource') ?? '') as FormValues['higherGovSourceType'],
  };
};

const paramsToCriteria = (p: URLSearchParams): SearchOpportunityCriteria | null => {
  if (!p.has('q') && !p.has('source') && !p.has('naics') && !p.has('setAside') && !p.has('from')) return null;
  const source = p.get('source') as 'SAM_GOV' | 'DIBBS' | 'HIGHER_GOV' | null;
  return {
    keywords:            p.get('q') ?? undefined,
    sources:             source ? [source] : undefined,
    naics:               p.get('naics')?.split(',').filter(Boolean) ?? undefined,
    setAsideCode:        p.get('setAside') ?? undefined,
    postedFrom:          p.get('from') ?? undefined,
    postedTo:            p.get('to') ?? undefined,
    closingFrom:         p.get('closingFrom') ?? undefined,
    closingTo:           p.get('closingTo') ?? undefined,
    higherGovSourceType: p.get('hgSource') ?? undefined,
    limit: 25,
  };
};

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  orgId: string;
  projectId: string;
}

export default function ProjectSearchOpportunitiesPage({ orgId, projectId }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { result, isLoading, isLoadingMore, hasMore, search, loadMore } = useSearchOpportunities(orgId);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [pendingImportBody, setPendingImportBody] = useState<Record<string, unknown> | null>(null);

  const savedSearchesUrl = `/organizations/${orgId}/projects/${projectId}/search-opportunities/saved-searches`;

  const initialFormValues = useRef(paramsToFormValues(searchParams));

  const syncToUrl = useCallback((criteria: SearchOpportunityCriteria) => {
    const params = criteriaToParams(criteria);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname]);

  const handleSearch = async (criteria: SearchOpportunityCriteria) => {
    setHasSearched(true);
    syncToUrl(criteria);
    await search(criteria);
  };

  // Auto-search on mount if URL has search params
  const didAutoSearch = useRef(false);
  useEffect(() => {
    if (didAutoSearch.current) return;
    const criteria = paramsToCriteria(searchParams);
    if (criteria) {
      didAutoSearch.current = true;
      setHasSearched(true);
      search(criteria);
    }
  }, [searchParams, search]);

  const doImportRequest = async (body: Record<string, unknown>) => {
    const res = await authFetcher(
      `${env.BASE_API_URL}/search-opportunities/import-solicitation`,
      { method: 'POST', body: JSON.stringify(body) },
    );

    if (res.status === 409) {
      const json = await res.json().catch(() => null) as { existing?: DuplicateInfo } | null;
      if (json?.existing) {
        setDuplicateInfo(json.existing);
        setPendingImportBody(body);
        setDuplicateDialogOpen(true);
        return;
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => 'Import failed');
      let message = 'Import failed';
      try { message = (JSON.parse(text) as { message?: string }).message ?? message; } catch { message = text; }
      throw new Error(message);
    }

    const data = await res.json() as { imported?: number };
    toast({
      title: 'Import started',
      description: `${data.imported ?? 0} attachment(s) queued for processing.`,
    });
  };

  const handleImport = async (id: string) => {
    const opp = result?.opportunities.find((o) => o.id === id);
    if (!opp) return;

    setImportingId(id);
    try {
      await doImportRequest(buildImportBody(opp, orgId, projectId));
    } catch (e: unknown) {
      toast({
        title: 'Import failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setImportingId(null);
    }
  };

  const handleForceImport = async () => {
    setDuplicateDialogOpen(false);
    if (!pendingImportBody) return;
    try {
      await doImportRequest({ ...pendingImportBody, force: true });
    } catch (e: unknown) {
      toast({
        title: 'Import failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const total = result?.total ?? 0;

  return (
    <div className="container mx-auto p-12">
      <PageHeader
        title="Search Opportunities"
        description="Search SAM.gov, DIBBS, and HigherGov — results import directly into this project."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={savedSearchesUrl}>
              <Bookmark className="mr-2 h-4 w-4" />
              Saved Searches
            </Link>
          </Button>
        }
      />

      <HigherGovFavoritesBanner orgId={orgId} projectId={projectId} />

      <div className="mb-6">
        <SearchOpportunityForm orgId={orgId} onSearch={handleSearch} isLoading={isLoading} initialValues={initialFormValues.current ?? undefined} />
      </div>

      {result?.samGovError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>SAM.gov error</AlertTitle>
          <AlertDescription className="text-xs">{result.samGovError}</AlertDescription>
        </Alert>
      )}

      {result?.dibbsError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>DIBBS error</AlertTitle>
          <AlertDescription className="text-xs">{result.dibbsError}</AlertDescription>
        </Alert>
      )}

      {hasSearched && !isLoading && result && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-4 py-2.5 mb-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {total === 0 ? (
                <span className="text-muted-foreground">No results found</span>
              ) : (
                <>
                  <span className="font-semibold">{result.opportunities.length}</span>
                  {total > result.opportunities.length && (
                    <span className="text-muted-foreground"> of {total.toLocaleString()}</span>
                  )}
                  <span className="text-muted-foreground"> results</span>
                </>
              )}
            </span>
          </div>
          <div className="flex gap-2 ml-auto">
            {result.totalSamGov > 0 && (
              <Badge className="text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">
                SAM.gov: {result.totalSamGov.toLocaleString()}
              </Badge>
            )}
            {result.totalDibbs > 0 && (
              <Badge className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                DIBBS: {result.totalDibbs.toLocaleString()}
              </Badge>
            )}
          </div>
        </div>
      )}

      {(hasSearched || isLoading) && (
        <SearchOpportunityResultsTable
          opportunities={result?.opportunities ?? []}
          isLoading={isLoading}
          onImport={handleImport}
          importingId={importingId}
          orgId={orgId}
        />
      )}

      {/* Load more */}
      {hasSearched && !isLoading && hasMore && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="min-w-[180px]">
            {isLoadingMore ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading more…</>
            ) : (
              <>Load more <span className="ml-1.5 text-muted-foreground text-xs">({result?.opportunities.length ?? 0} / {(result?.total ?? 0).toLocaleString()})</span></>
            )}
          </Button>
        </div>
      )}
      {hasSearched && !isLoading && !hasMore && (result?.opportunities.length ?? 0) > 0 && (
        <p className="text-center text-xs text-muted-foreground mt-4">
          All {(result?.total ?? 0).toLocaleString()} results loaded
        </p>
      )}

      {!hasSearched && !isLoading && (
        <div className="border rounded-lg p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-4">
              <Search className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h3 className="text-lg font-medium mb-2">Ready to search</h3>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Search across SAM.gov, DIBBS, and HigherGov. Any opportunity you import will be added directly to this project.
          </p>
        </div>
      )}

      <DuplicateSolicitationDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        duplicate={duplicateInfo}
        onConfirm={handleForceImport}
      />
    </div>
  );
}

