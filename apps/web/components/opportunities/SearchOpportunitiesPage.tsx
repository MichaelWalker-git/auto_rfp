'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
import { AlertCircle, Bookmark, Key, Layers, Loader2, Search, Settings, ChevronDown } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { SearchOpportunityForm } from './SearchOpportunityForm';
import { SearchOpportunityResultsTable } from './SearchOpportunityResultsTable';
import { SavedSearchList } from '@/components/organizations/SavedSearchList';
import { useSearchOpportunities, PAGE_SIZE_OPTIONS } from '@/lib/hooks/use-search-opportunities';
import type { PageSizeOption } from '@/lib/hooks/use-search-opportunities';
import { useProjectContext } from '@/context/project-context';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { SearchOpportunityCriteria } from '@/lib/hooks/use-search-opportunities';
import type { SavedSearch } from '@auto-rfp/core';

interface Props {
  orgId: string;
}

export default function SearchOpportunitiesPage({ orgId }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { result, isLoading, isLoadingMore, hasMore, search, loadMore } = useSearchOpportunities(orgId);
  const { projects } = useProjectContext();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'saved'>('search');
  const [pageSize, setPageSize] = useState<PageSizeOption>(25);
  const [lastCriteriaRef, setLastCriteriaRef] = useState<SearchOpportunityCriteria | null>(null);

  const effectiveProjectId = selectedProjectId || projects?.[0]?.id;

  const handleSearch = async (criteria: SearchOpportunityCriteria) => {
    setHasSearched(true);
    setActiveTab('search');
    const withPageSize = { ...criteria, limit: pageSize };
    setLastCriteriaRef(withPageSize);
    await search(withPageSize);
  };

  const handlePageSizeChange = async (val: string) => {
    const newSize = Number(val) as PageSizeOption;
    setPageSize(newSize);
    if (lastCriteriaRef) {
      const updated = { ...lastCriteriaRef, limit: newSize };
      setLastCriteriaRef(updated);
      await search(updated);
    }
  };

  const handleImport = async (id: string) => {
    if (!effectiveProjectId) {
      toast({
        title: 'No project selected',
        description: 'Please select a project to import into.',
        variant: 'destructive',
      });
      return;
    }

    const opp = result?.opportunities.find((o) => o.id === id);
    if (!opp) return;

    setImportingId(id);
    try {
      const body = opp.source === 'SAM_GOV'
        ? {
            source: 'SAM_GOV',
            orgId,
            projectId: effectiveProjectId,
            noticeId: opp.noticeId ?? id,
            postedFrom: opp.postedDate
              ? formatMMDDYYYY(new Date(opp.postedDate))
              : formatMMDDYYYY(new Date(Date.now() - 30 * 86_400_000)),
            postedTo: formatMMDDYYYY(new Date()),
          }
        : {
            source: 'DIBBS',
            orgId,
            projectId: effectiveProjectId,
            solicitationNumber: opp.solicitationNumber ?? id,
          };

      const res = await authFetcher(
        `${env.BASE_API_URL}/search-opportunities/import-solicitation`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) throw new Error(await res.text().catch(() => 'Import failed'));
      const data = await res.json() as { imported?: number };
      toast({
        title: 'Import started',
        description: `${data.imported ?? 0} attachment(s) queued for processing.`,
      });
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

  // ── API key status ────────────────────────────────────────────────────────
  const [apiKeyStatus, setApiKeyStatus] = useState<{
    SAM_GOV: boolean;
    DIBBS: boolean;
  } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    authFetcher(`${env.BASE_API_URL}/search-opportunities/api-key?orgId=${encodeURIComponent(orgId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as {
          sources?: { SAM_GOV?: { configured?: boolean }; DIBBS?: { configured?: boolean } };
        };
        setApiKeyStatus({
          SAM_GOV: !!data.sources?.SAM_GOV?.configured,
          DIBBS:   !!data.sources?.DIBBS?.configured,
        });
      })
      .catch(() => {/* silently fail */});
  }, [orgId]);

  const noneConfigured = apiKeyStatus && !apiKeyStatus.SAM_GOV && !apiKeyStatus.DIBBS;
  const partiallyConfigured = apiKeyStatus && (apiKeyStatus.SAM_GOV || apiKeyStatus.DIBBS) && !(apiKeyStatus.SAM_GOV && apiKeyStatus.DIBBS);

  const total = result?.total ?? 0;

  const handleOpenSavedSearch = (s: SavedSearch) => {
    const encoded = encodeURIComponent(JSON.stringify(s.criteria));
    router.push(`${pathname}?search=${encoded}`);
    setActiveTab('search');
  };

  return (
    <div className="container mx-auto p-8 max-w-7xl">
      {/* ── Page header ── */}
      <PageHeader
        title="Search Opportunities"
        description="Search SAM.gov and DIBBS simultaneously — all configured sources in one place."
        actions={
          projects && projects.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Import into:</span>
              <Select
                value={selectedProjectId || projects[0]?.id}
                onValueChange={setSelectedProjectId}
              >
                <SelectTrigger className="w-48 h-9 text-sm">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : undefined
        }
      />

      {/* ── API key banners ── */}
      {noneConfigured && (
        <Alert variant="destructive" className="mb-4">
          <Key className="h-4 w-4" />
          <AlertTitle>No integrations configured</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-sm">
              No API keys are configured. Configure <strong>SAM.gov</strong> and/or <strong>DIBBS</strong> to start searching.
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
                ? 'SAM.gov is configured. Add a DIBBS API key to also search DoD defense opportunities.'
                : 'DIBBS is configured. Add a SAM.gov API key to also search federal civilian opportunities.'}
            </p>
            <Link href={`/organizations/${orgId}/settings`} className="text-xs text-blue-600 underline font-medium">
              Add {apiKeyStatus?.SAM_GOV ? 'DIBBS' : 'SAM.gov'} API key in Settings →
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Tabs ── */}
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

        {/* ── Search tab ── */}
        <TabsContent value="search" className="space-y-4 mt-0">
          {/* Filter form */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <SearchOpportunityForm orgId={orgId} onSearch={handleSearch} isLoading={isLoading} />
          </div>

          {/* Source errors */}
          {result?.samGovError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>SAM.gov error</AlertTitle>
              <AlertDescription className="text-xs">{result.samGovError}</AlertDescription>
            </Alert>
          )}
          {result?.dibbsError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>DIBBS error</AlertTitle>
              <AlertDescription className="text-xs">{result.dibbsError}</AlertDescription>
            </Alert>
          )}

          {/* Results summary bar */}
          {hasSearched && !isLoading && result && (
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
                {result.totalDibbs > 0 && (
                  <Badge className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                    DIBBS: {result.totalDibbs.toLocaleString()}
                  </Badge>
                )}
                {/* Page size selector */}
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
              onImport={handleImport}
              importingId={importingId}
              orgId={orgId}
            />
          )}

          {/* Load more + progress */}
          {hasSearched && !isLoading && (result?.opportunities.length ?? 0) > 0 && (
            <div className="flex flex-col items-center gap-3 pt-2">
              {/* Progress bar */}
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
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-muted-foreground/40 hover:decoration-foreground/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoadingMore ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</>
                  ) : (
                    <><ChevronDown className="h-3.5 w-3.5" />Show {pageSize} more</>
                  )}
                </button>
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
              <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                Enter keywords or use the filters above to search across all configured opportunity sources.
                Results from SAM.gov and DIBBS will appear together.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Saved searches tab ── */}
        <TabsContent value="saved" className="mt-0">
          <SavedSearchList
            orgId={orgId}
            onOpen={handleOpenSavedSearch}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const formatMMDDYYYY = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
