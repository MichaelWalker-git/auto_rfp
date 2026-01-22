'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useSearchParams } from 'next/navigation';

import type { LoadSamOpportunitiesRequest, SamOpportunitySlim, MmDdYyyy } from '@auto-rfp/shared';
import { useSearchOpportunities } from '@/lib/hooks/use-opportunities';

import { defaultDateRange, filtersToRequest, reqToFiltersState, safeDecodeSearchParam, isoToMMDDYYYY } from './samgov-utils';
import { SamGovFilters, type SamGovFiltersState } from './samgov-filters';
import { SamGovOpportunityList } from './samgov-opportunity-list';

import { useImportSolicitation } from '@/lib/hooks/use-import-solicitation';
import { ImportSolicitationDialog } from '@/components/samgov/import-solicitation-dialog';
import { useProjectContext } from '@/context/project-context';

type Props = { orgId: string };

export default function SamGovOpportunitySearchPage({ orgId }: Props) {
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const { data, isMutating: isLoading, error, trigger } = useSearchOpportunities();
  const { projects } = useProjectContext();

  const initial = React.useMemo(() => defaultDateRange(14, 0), []);

  // --- URL bootstrap (only once per mount) ---
  const bootstrappedRef = React.useRef(false);

  const [filters, setFilters] = React.useState<SamGovFiltersState>(() => ({
    keywords: '',
    naicsCsv: '541511',
    agencyName: '',
    setAsideCode: '',
    ptypeCsv: '',
    postedFrom: initial.postedFrom,
    postedTo: initial.postedTo,
    rdlfrom: initial.rdlfrom,
  }));

  React.useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    const raw = searchParams?.get('search');
    if (!raw) return;

    const parsed = safeDecodeSearchParam(raw);
    if (!parsed || typeof parsed !== 'object') {
      toast({
        title: 'Invalid saved search',
        description: 'Could not parse the search filters from the URL.',
        variant: 'destructive',
      });
      return;
    }

    // parsed should be LoadSamOpportunitiesRequest-ish
    const nextFilters = reqToFiltersState(parsed, initial);
    setFilters(nextFilters);

    // auto-run the search once with the parsed request
    const req = filtersToRequest(nextFilters, {
      limit: typeof parsed.limit === 'number' ? parsed.limit : 25,
      offset: typeof parsed.offset === 'number' ? parsed.offset : 0,
    });

    trigger(req).catch((e: any) => {
      toast({
        title: 'SAM.gov search failed',
        description: e?.message ?? String(e),
        variant: 'destructive',
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, initial.postedFrom, initial.postedTo, trigger, toast]);

  React.useEffect(() => {
    if (error) {
      toast({
        title: 'SAM.gov search failed',
        description: typeof error === 'string' ? error : (error as any)?.message ?? String(error),
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  const activeFilterCount = React.useMemo(() => {
    return [
      filters.keywords.trim(),
      filters.agencyName.trim(),
      filters.setAsideCode.trim(),
      filters.ptypeCsv.trim(),
      filters.naicsCsv.trim() !== '541511' ? 'naics' : '',
    ].filter(Boolean).length;
  }, [filters]);

  const onSearch = async (req: LoadSamOpportunitiesRequest) => {
    await trigger(req);
  };

  const onPage = async (nextOffset: number) => {
    const req = filtersToRequest(filters, { limit: data?.limit ?? 25, offset: nextOffset });
    await trigger(req);
  };

  // -------- Import dialog state ----------
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pendingOpp, setPendingOpp] = React.useState<SamOpportunitySlim | null>(null);
  const { trigger: importSolicitation, isMutating: isImporting } = useImportSolicitation();

  const onImportSolicitation = (opportunity: SamOpportunitySlim) => {
    setPendingOpp(opportunity);
    setDialogOpen(true);
  };

  const doImport = async (args: { orgId: string; projectId: string; noticeId: string }) => {
    try {
      const res = await importSolicitation({
        ...args,
        postedFrom: isoToMMDDYYYY(filters.postedFrom),
        postedTo: isoToMMDDYYYY(filters.postedTo),
      });

      toast({
        title: 'Import started',
        description: `Imported ${res.imported} attachment(s). Pipeline execution(s) started.`,
      });
    } catch (e: any) {
      toast({
        title: 'Import failed',
        description: e?.message ?? String(e),
        variant: 'destructive',
      });
      throw e;
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Search className="h-6 w-6 text-primary"/>
            Opportunities
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search SAM.gov and import solicitations into your pipeline.
          </p>
        </div>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-4 md:p-5">
          <SamGovFilters
            orgId={orgId}
            isSearching={isLoading}
            value={filters}
            onChange={setFilters}
            activeFilterCount={activeFilterCount}
            onSearch={onSearch}
          />
        </CardContent>
      </Card>

      {data && (
        <div className="mt-5 flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
          <div className="text-sm">
            {data.totalRecords === 0 ? (
              <span className="text-muted-foreground">No opportunities found.</span>
            ) : (
              <>
                Showing{' '}
                <span className="font-semibold">
                  {Math.min(data.totalRecords, (data.offset ?? 0) + 1)}–
                  {Math.min(data.totalRecords, (data.offset ?? 0) + (data.opportunities?.length ?? 0))}
                </span>{' '}
                of <span className="font-semibold">{data?.totalRecords?.toLocaleString()}</span>
              </>
            )}
          </div>
          {data.totalRecords > (data.limit ?? 25) && (
            <div className="text-sm text-muted-foreground">
              Page {Math.floor((data.offset ?? 0) / (data.limit ?? 25)) + 1} /{' '}
              {Math.max(1, Math.ceil(data.totalRecords / (data.limit ?? 25)))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <SamGovOpportunityList
          data={data as any}
          isLoading={isLoading}
          onPage={onPage}
          onImportSolicitation={onImportSolicitation}
        />
      </div>

      <ImportSolicitationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orgId={orgId}
        opportunity={pendingOpp}
        projects={projects}
        isImporting={isImporting}
        onImport={doImport}
      />
    </div>
  );
}