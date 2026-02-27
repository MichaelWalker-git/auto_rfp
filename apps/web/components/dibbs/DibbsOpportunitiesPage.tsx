'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Key } from 'lucide-react';
import Link from 'next/link';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import {
  DibbsSearchForm,
  DibbsResultsTable,
  useDibbsSearch,
  useDibbsImport,
} from '@/features/dibbs';
import type { SearchDibbsOpportunitiesRequest } from '@auto-rfp/core';
import { useProjectContext } from '@/context/project-context';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

interface Props {
  orgId: string;
}

export default function DibbsOpportunitiesPage({ orgId }: Props) {
  const { toast } = useToast();
  const { data, isLoading, error, search } = useDibbsSearch(orgId);
  const { importSolicitation, isLoading: isImporting } = useDibbsImport();
  const { projects } = useProjectContext();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const res = await authFetcher(
          `${env.BASE_API_URL}/search-opportunities/api-key?source=DIBBS&orgId=${encodeURIComponent(orgId)}`,
        );
        if (res.ok) {
          const result = await res.json() as { apiKey: string | null };
          setHasApiKey(!!result.apiKey);
        } else {
          setHasApiKey(false);
        }
      } catch {
        setHasApiKey(false);
      }
    };
    checkApiKey();
  }, [orgId]);

  const handleSearch = async (criteria: SearchDibbsOpportunitiesRequest) => {
    await search(criteria);
    if (error) {
      toast({
        title: 'DIBBS search failed',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleImport = async (solicitationNumber: string) => {
    const defaultProject = projects?.[0];
    if (!defaultProject) {
      toast({
        title: 'No project selected',
        description: 'Please create or select a project before importing.',
        variant: 'destructive',
      });
      return;
    }

    setImportingId(solicitationNumber);
    try {
      const result = await importSolicitation({
        orgId,
        projectId: defaultProject.id,
        solicitationNumber,
      });
      toast({
        title: 'Import started',
        description: `Imported ${result?.imported ?? 0} attachment(s). Pipeline execution started.`,
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

  return (
    <div className="container mx-auto p-12">
      {hasApiKey === false && (
        <Alert className="mb-6">
          <Key className="h-4 w-4" />
          <AlertTitle>DIBBS API key not configured</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              At least one API key must be configured to use this integration.
              Configure your DIBBS API key in Settings to search and import DoD opportunities.
            </p>
            <p className="text-xs text-muted-foreground">
              You can also configure a <strong>SAM.gov</strong> API key for broader federal opportunity coverage.
              Both integrations can be active simultaneously.
            </p>
            <Link href={`/organizations/${orgId}/settings`}>
              <Button size="sm" className="mt-2">
                <Key className="h-4 w-4 mr-2" />
                Configure API Keys in Settings
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <ListingPageLayout
        title="DIBBS Opportunities"
        description="Search the Defense Industrial Base Bidding System and import solicitations into your pipeline."
        onReload={undefined}
        isReloading={isLoading}
        filters={
          <DibbsSearchForm onSearch={handleSearch} isLoading={isLoading} />
        }
        isEmpty={!data?.opportunities?.length && !isLoading}
      >
        {data && (
          <div className="flex justify-between rounded-xl border bg-muted/30 px-4 py-3 mb-2">
            <div className="text-sm">
              {data.totalRecords === 0 ? (
                <span className="text-muted-foreground">No opportunities found.</span>
              ) : (
                <>
                  <span className="font-semibold">
                    {Math.min(data.totalRecords, (data.offset ?? 0) + 1)}–
                    {Math.min(data.totalRecords, (data.offset ?? 0) + (data.opportunities?.length ?? 0))}
                  </span>{' '}
                  of <span className="font-semibold">{data.totalRecords.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>
        )}

        <DibbsResultsTable
          opportunities={data?.opportunities ?? []}
          isLoading={isLoading}
          onImport={handleImport}
          importingId={importingId}
        />
      </ListingPageLayout>
    </div>
  );
}
