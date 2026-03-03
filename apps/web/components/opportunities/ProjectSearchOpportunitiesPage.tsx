'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Bookmark, Layers, Loader2, Search } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { SearchOpportunityForm } from './SearchOpportunityForm';
import { SearchOpportunityResultsTable } from './SearchOpportunityResultsTable';
import { useSearchOpportunities } from '@/lib/hooks/use-search-opportunities';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { SearchOpportunityCriteria } from '@/lib/hooks/use-search-opportunities';

interface Props {
  orgId: string;
  projectId: string;
}

export default function ProjectSearchOpportunitiesPage({ orgId, projectId }: Props) {
  const { toast } = useToast();
  const { result, isLoading, isLoadingMore, hasMore, search, loadMore } = useSearchOpportunities(orgId);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const savedSearchesUrl = `/organizations/${orgId}/projects/${projectId}/search-opportunities/saved-searches`;

  const handleSearch = async (criteria: SearchOpportunityCriteria) => {
    setHasSearched(true);
    await search(criteria);
  };

  const handleImport = async (id: string) => {
    const opp = result?.opportunities.find((o) => o.id === id);
    if (!opp) return;

    setImportingId(id);
    try {
      const body = opp.source === 'SAM_GOV'
        ? {
            source: 'SAM_GOV',
            orgId,
            projectId,
            noticeId: opp.noticeId ?? id,
            postedFrom: opp.postedDate
              ? formatMMDDYYYY(new Date(opp.postedDate))
              : formatMMDDYYYY(new Date(Date.now() - 30 * 86_400_000)),
            postedTo: formatMMDDYYYY(new Date()),
          }
        : {
            source: 'DIBBS',
            orgId,
            projectId,
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

  const total = result?.total ?? 0;

  return (
    <div className="container mx-auto p-12">
      <PageHeader
        title="Search Opportunities"
        description="Search SAM.gov and DIBBS — results import directly into this project."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={savedSearchesUrl}>
              <Bookmark className="mr-2 h-4 w-4" />
              Saved Searches
            </Link>
          </Button>
        }
      />

      <div className="mb-6">
        <SearchOpportunityForm orgId={orgId} onSearch={handleSearch} isLoading={isLoading} />
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
            Search across SAM.gov and DIBBS. Any opportunity you import will be added directly to this project.
          </p>
        </div>
      )}
    </div>
  );
}

const formatMMDDYYYY = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
