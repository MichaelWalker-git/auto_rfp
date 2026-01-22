'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useSearchParams } from 'next/navigation';

import type { LoadSamOpportunitiesRequest, SamOpportunitySlim } from '@auto-rfp/shared';
import { useSearchOpportunities } from '@/lib/hooks/use-opportunities';

import { defaultDateRange, filtersToRequest, reqToFiltersState, safeDecodeSearchParam } from './samgov-utils';
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

  const initial = React.useMemo(() => defaultDateRange(14), []);

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
    minDaysUntilDue: 0,
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
      filters.minDaysUntilDue > 0 ? 'minDays' : '',
    ].filter(Boolean).length;
  }, [filters]);

  // Client-side filtering for minDaysUntilDue (SAM.gov API doesn't support deadline filters)
  const filteredData = React.useMemo(() => {
    if (!data) return data;
    if (filters.minDaysUntilDue <= 0) return data;

    const now = new Date();
    const minDate = new Date(now.getTime() + filters.minDaysUntilDue * 24 * 60 * 60 * 1000);

    const filteredOpportunities = data.opportunities?.filter((opp: SamOpportunitySlim) => {
      if (!opp.responseDeadLine) return true; // Keep opportunities without a deadline
      const dueDate = new Date(opp.responseDeadLine);
      return dueDate >= minDate;
    }) ?? [];

    return {
      ...data,
      opportunities: filteredOpportunities,
      totalRecords: filteredOpportunities.length,
    };
  }, [data, filters.minDaysUntilDue]);

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
        postedFrom: filters.postedFrom,
        postedTo: filters.postedTo,
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

      {filteredData && (
        <div className="mt-5 flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
          <div className="text-sm">
            {filteredData.totalRecords === 0 ? (
              <span className="text-muted-foreground">No opportunities found.</span>
            ) : (
              <>
                Showing{' '}
                <span className="font-semibold">
                  {Math.min(filteredData.totalRecords, (filteredData.offset ?? 0) + 1)}–
                  {Math.min(filteredData.totalRecords, (filteredData.offset ?? 0) + (filteredData.opportunities?.length ?? 0))}
                </span>{' '}
                of <span className="font-semibold">{filteredData?.totalRecords?.toLocaleString()}</span>
                {filters.minDaysUntilDue > 0 && data && data.totalRecords !== filteredData.totalRecords && (
                  <span className="text-muted-foreground ml-1">
                    ({data.totalRecords - filteredData.totalRecords} filtered by deadline)
                  </span>
                )}
              </>
            )}
          </div>
          {filteredData.totalRecords > (filteredData.limit ?? 25) && (
            <div className="text-sm text-muted-foreground">
              Page {Math.floor((filteredData.offset ?? 0) / (filteredData.limit ?? 25)) + 1} /{' '}
              {Math.max(1, Math.ceil(filteredData.totalRecords / (filteredData.limit ?? 25)))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <SamGovOpportunityList
          data={filteredData as any}
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