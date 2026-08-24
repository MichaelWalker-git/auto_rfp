'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Bookmark, Info, Key, Layers, Loader2, Search, Settings } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { SearchOpportunityForm } from './SearchOpportunityForm';
import { criteriaToParams, paramsToCriteria, paramsToFormValues } from './search-criteria-url';
import { buildImportBody } from './build-import-body';
import { SearchOpportunityResultsTable } from './SearchOpportunityResultsTable';
import { ImportFromUrlDialog } from './ImportFromUrlDialog';
import { SavedSearchList } from '@/components/organizations/SavedSearchList';
import { useSearchOpportunities, PAGE_SIZE_OPTIONS } from '@/lib/hooks/use-search-opportunities';
import type { PageSizeOption, SearchOpportunityCriteria } from '@/lib/hooks/use-search-opportunities';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { SavedSearch } from '@auto-rfp/core';
import type { DuplicateInfo } from '@/lib/hooks/use-import-solicitation';
import { DuplicateSolicitationDialog } from '@/components/samgov/duplicate-solicitation-dialog';
import { HigherGovFavoritesBanner } from './HigherGovFavoritesBanner';

// URL ↔ criteria serialization lives in ./search-criteria-url.

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  orgId: string;
  projectId: string;
}

/** Convert MM/dd/yyyy to ISO date string (yyyy-MM-dd) */
const isoFromMmdd = (s: string): string | undefined => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined;
};

/**
 * Canonical Search Opportunities page.
 *
 * This is the only search surface: it matches the sidebar entry and the
 * "imports land in this project" model, so there is never a question of which
 * project an import belongs to. The former org-level page redirects here.
 */
export default function ProjectSearchOpportunitiesPage({ orgId, projectId }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { result, isLoading, isLoadingMore, hasMore, search, loadMore } = useSearchOpportunities(orgId);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'saved'>('search');
  const [pageSize, setPageSize] = useState<PageSizeOption>(() => {
    const fromUrl = searchParams.get('limit');
    return fromUrl ? (Number(fromUrl) as PageSizeOption) : 25;
  });
  const [lastCriteriaRef, setLastCriteriaRef] = useState<SearchOpportunityCriteria | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [pendingImportBody, setPendingImportBody] = useState<Record<string, unknown> | null>(null);

  const initialFormValues = useRef(paramsToFormValues(searchParams));

  const syncToUrl = useCallback((criteria: SearchOpportunityCriteria) => {
    const params = criteriaToParams(criteria);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname]);

  const handleSearch = async (criteria: SearchOpportunityCriteria) => {
    setHasSearched(true);
    setActiveTab('search');
    const withPageSize = { ...criteria, limit: pageSize };
    setLastCriteriaRef(withPageSize);
    syncToUrl(withPageSize);
    await search(withPageSize);
  };

  // Auto-search on mount if URL has search params
  const didAutoSearch = useRef(false);
  useEffect(() => {
    if (didAutoSearch.current) return;
    const criteria = paramsToCriteria(searchParams);
    if (criteria) {
      didAutoSearch.current = true;
      const withPageSize = { ...criteria, limit: pageSize };
      setLastCriteriaRef(withPageSize);
      setHasSearched(true);
      search(withPageSize);
    }
  }, [searchParams, pageSize, search]);

  const handlePageSizeChange = async (val: string) => {
    const newSize = Number(val) as PageSizeOption;
    setPageSize(newSize);
    if (lastCriteriaRef) {
      const updated = { ...lastCriteriaRef, limit: newSize };
      setLastCriteriaRef(updated);
      syncToUrl(updated);
      await search(updated);
    }
  };

  const opportunityUrl = (oppId: string) =>
    `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`;

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

    const data = await res.json() as { imported?: number; opportunityId?: string };

    // Import is only the first half of the flow — documents are pulled and the
    // question pipeline starts immediately. Link straight to the opportunity so the
    // user can watch that happen instead of being left on the search page.
    toast({
      title: 'Import started — analysis running',
      description: `${data.imported ?? 0} document(s) pulled in and queued for analysis.`,
      action: data.opportunityId ? (
        <Button asChild size="sm" variant="outline">
          <Link href={opportunityUrl(data.opportunityId)}>View</Link>
        </Button>
      ) : undefined,
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

  /**
   * Bulk import. Runs sequentially rather than in parallel: each import downloads
   * attachments and starts a Step Functions execution, so firing a whole page at
   * once would spike the import Lambda and the provider's rate limit.
   */
  const handleImportMany = async (ids: string[]) => {
    let ok = 0;
    const failures: string[] = [];

    for (const id of ids) {
      const opp = result?.opportunities.find((o) => o.id === id);
      if (!opp) continue;
      setImportingId(id);
      try {
        await doImportRequest(buildImportBody(opp, orgId, projectId));
        ok++;
      } catch {
        // Keep going: one bad solicitation should not abandon the rest of the batch.
        failures.push(opp.title || id);
      }
    }
    setImportingId(null);

    if (failures.length) {
      toast({
        title: `Imported ${ok} of ${ids.length}`,
        description: `Failed: ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? `, +${failures.length - 3} more` : ''}`,
        variant: 'destructive',
      });
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

  const handleImportUrl = async (url: string, title?: string) => {
    await doImportRequest({ source: 'MANUAL_UPLOAD', orgId, projectId, url, title });
  };

  // ── API key status ────────────────────────────────────────────────────────
  // DIBBS is intentionally not surfaced: it is still wired in the backend but is
  // not a provider this product can use, so advertising it only produced empty
  // searches users could not explain.
  const [apiKeyStatus, setApiKeyStatus] = useState<{
    SAM_GOV: boolean;
    HIGHER_GOV: boolean;
  } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    authFetcher(`${env.BASE_API_URL}/search-opportunities/api-key?orgId=${encodeURIComponent(orgId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as {
          sources?: { SAM_GOV?: { configured?: boolean }; HIGHER_GOV?: { configured?: boolean } };
        };
        setApiKeyStatus({
          SAM_GOV:    !!data.sources?.SAM_GOV?.configured,
          HIGHER_GOV: !!data.sources?.HIGHER_GOV?.configured,
        });
      })
      .catch(() => {/* silently fail */});
  }, [orgId]);

  const noneConfigured = apiKeyStatus && !apiKeyStatus.SAM_GOV && !apiKeyStatus.HIGHER_GOV;
  const partiallyConfigured = apiKeyStatus
    && (apiKeyStatus.SAM_GOV || apiKeyStatus.HIGHER_GOV)
    && !(apiKeyStatus.SAM_GOV && apiKeyStatus.HIGHER_GOV);

  const total = result?.total ?? 0;

  const handleOpenSavedSearch = (s: SavedSearch) => {
    const c = s.criteria;
    const source = s.source === 'HIGHER_GOV' ? 'HIGHER_GOV' : 'SAM_GOV';
    const criteria: SearchOpportunityCriteria = {
      keywords:            c.keywords ?? undefined,
      sources:             [source],
      naics:               c.naics ?? undefined,
      setAsideCode:        c.setAsideCode ?? undefined,
      postedFrom:          c.postedFrom ? isoFromMmdd(c.postedFrom) : undefined,
      postedTo:            c.postedTo ? isoFromMmdd(c.postedTo) : undefined,
      closingFrom:         c.closingFrom ? isoFromMmdd(c.closingFrom) : undefined,
      closingTo:           c.closingTo ? isoFromMmdd(c.closingTo) : undefined,
      higherGovSourceType: c.higherGovSourceType ?? undefined,
      // Carrying this is essential, not optional: a HigherGov saved search IS its
      // search_id. Dropping it re-ran the search as a plain keyword query, which
      // HigherGov's API cannot serve — so opening a saved search always errored.
      higherGovSearchId:   c.higherGovSearchId ?? undefined,
      limit:               pageSize,
    };
    syncToUrl(criteria);
    setActiveTab('search');
    setHasSearched(true);
    setLastCriteriaRef(criteria);
    search(criteria);
  };

  return (
    <div className="container mx-auto p-8 max-w-7xl">
      <PageHeader
        title="Search Opportunities"
        description="Search SAM.gov and HigherGov. Importing pulls the solicitation documents into this project and starts analysis automatically."
      />

      {/* ── API key banners ── */}
      {noneConfigured && (
        <Alert variant="destructive" className="mb-4">
          <Key className="h-4 w-4" />
          <AlertTitle>No integrations configured</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-sm">
              No API keys are configured. Add a <strong>SAM.gov</strong> or <strong>HigherGov</strong> key to start searching.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href={`/organizations/${orgId}/settings`}>
                <Settings className="mr-2 h-3.5 w-3.5" />
                Configure API Keys
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {partiallyConfigured && (
        <Alert className="mb-4 border-blue-200 bg-blue-50/50">
          <Key className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-800">More integrations available</AlertTitle>
          <AlertDescription className="space-y-1">
            <p className="text-sm text-blue-700">
              {apiKeyStatus?.SAM_GOV
                ? 'SAM.gov is configured. Add a HigherGov API key to also search SBIR, grants, and state & local opportunities.'
                : 'HigherGov is configured. Add a SAM.gov API key to also search federal opportunities by title, NAICS, and set-aside.'}
            </p>
            <Link href={`/organizations/${orgId}/settings`} className="text-xs text-blue-600 underline font-medium">
              Add {apiKeyStatus?.SAM_GOV ? 'HigherGov' : 'SAM.gov'} API key in Settings →
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* ── HigherGov favorites — a ready-made bulk import ── */}
      <HigherGovFavoritesBanner orgId={orgId} projectId={projectId} />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'search' | 'saved')} className="mt-2">
        <TabsList className="mb-4">
          <TabsTrigger value="search" className="gap-2">
            <Search className="h-4 w-4" />
            Search
          </TabsTrigger>
          <TabsTrigger value="saved" className="gap-2">
            <Bookmark className="h-4 w-4" />
            Saved Searches
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-4 mt-0">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <SearchOpportunityForm
              orgId={orgId}
              projectId={projectId}
              onSearch={handleSearch}
              isLoading={isLoading}
              initialValues={initialFormValues.current ?? undefined}
            />
          </div>

          {/* Source warnings — partial results from slow/unavailable providers */}
          {result?.samGovError && (
            <Alert variant="default" className="border-orange-200 bg-orange-50 text-orange-900">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <AlertTitle>SAM.gov unavailable</AlertTitle>
              <AlertDescription className="text-xs">{result.samGovError}</AlertDescription>
            </Alert>
          )}
          {result?.higherGovError && (
            result.higherGovError.startsWith('Keyword, NAICS, and set-aside search for HigherGov') ? (
              // Actionable guidance, not an outage. Reachable only for saved searches
              // created before filters became provider-aware.
              <Alert variant="default" className="border-blue-200 bg-blue-50 text-blue-900">
                <Info className="h-4 w-4 text-blue-500" />
                <AlertTitle>HigherGov needs a saved search</AlertTitle>
                <AlertDescription className="text-xs">{result.higherGovError}</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="default" className="border-orange-200 bg-orange-50 text-orange-900">
                <AlertCircle className="h-4 w-4 text-orange-500" />
                <AlertTitle>HigherGov unavailable</AlertTitle>
                <AlertDescription className="text-xs">{result.higherGovError}</AlertDescription>
              </Alert>
            )
          )}
          {result?.higherGovPending && !result.higherGovError && (
            // HigherGov saved searches can take ~30s+ — fetched in the background,
            // results appear here automatically once ready (the hook polls).
            <Alert variant="default" className="border-blue-200 bg-blue-50 text-blue-900">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <AlertTitle>Fetching HigherGov results…</AlertTitle>
              <AlertDescription className="text-xs">
                HigherGov saved searches can take up to a minute. Results will appear automatically — no need to search again.
              </AlertDescription>
            </Alert>
          )}

          {/* Results summary bar */}
          {hasSearched && !isLoading && !result?.higherGovPending && result && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-4 py-2.5">
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
              <div className="flex items-center gap-2 ml-auto">
                {result.totalSamGov > 0 && (
                  <Badge className="text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">
                    SAM.gov: {result.totalSamGov.toLocaleString()}
                  </Badge>
                )}
                {/* HigherGov had no badge at all despite being a primary provider. */}
                {result.totalHigherGov > 0 && (
                  <Badge className="text-xs bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50">
                    HigherGov: {result.totalHigherGov.toLocaleString()}
                  </Badge>
                )}
                <div className="flex items-center gap-1.5 border-l pl-3 ml-1">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Per page:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={handlePageSizeChange}
                    disabled={isLoading}
                  >
                    <SelectTrigger className="h-7 w-16 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)} className="text-xs">
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Results */}
          {(hasSearched || isLoading) && (
            <SearchOpportunityResultsTable
              opportunities={result?.opportunities ?? []}
              isLoading={isLoading}
              isPending={result?.higherGovPending}
              onImport={handleImport}
              onImportMany={handleImportMany}
              importingId={importingId}
              orgId={orgId}
            />
          )}

          {/* Load more */}
          {hasSearched && !isLoading && (result?.opportunities.length ?? 0) > 0 && (
            <div className="flex flex-col items-center gap-3 pt-2">
              {total > 0 && (
                <div className="w-full max-w-sm space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{(result?.opportunities.length ?? 0).toLocaleString()} loaded</span>
                    <span>{total.toLocaleString()} total</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.min(100, ((result?.opportunities.length ?? 0) / total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {hasMore ? (
                <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="min-w-[180px]">
                  {isLoadingMore ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading more…</>
                  ) : (
                    <>Show {pageSize} more</>
                  )}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  All {total.toLocaleString()} results shown
                </p>
              )}
            </div>
          )}

          {/* Initial empty state */}
          {!hasSearched && !isLoading && (
            <div className="border rounded-xl p-12 text-center bg-muted/10">
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-primary/10 p-4">
                  <Search className="h-8 w-8 text-primary" />
                </div>
              </div>
              <h3 className="text-lg font-medium mb-2">Ready to search</h3>
              <p className="text-muted-foreground max-w-md mx-auto text-sm">
                Pick a provider above and search. Importing any result pulls its documents
                into this project and starts analysis straight away.
              </p>
            </div>
          )}

          {/* Fallback for sources without an API — deliberately understated, below
              the primary search flow. */}
          <ImportFromUrlDialog onImport={handleImportUrl} />
        </TabsContent>

        <TabsContent value="saved" className="mt-0">
          <SavedSearchList
            orgId={orgId}
            onOpen={handleOpenSavedSearch}
          />
        </TabsContent>
      </Tabs>

      <DuplicateSolicitationDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        duplicate={duplicateInfo}
        onConfirm={handleForceImport}
      />
    </div>
  );
}
