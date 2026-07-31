'use client';

import { useMemo, useState } from 'react';
import type { RfpPipelineItem } from '@auto-rfp/core';
import {
  filterItems,
  lastNWeeksRange,
  ownerOptions,
  throughputByWeek,
  funnel,
  cycleTime,
  winRate,
  outcomeBreakdown,
  aging,
} from '../lib/derive-metrics';
import {
  exportThroughputCsv,
  exportFunnelCsv,
  exportCycleTimeCsv,
  exportOutcomeCsv,
  exportAgingCsv,
} from '../lib/export-metrics-csv';
import { MetricsFilters } from './MetricsFilters';
import { ThroughputChart } from './ThroughputChart';
import { FunnelTable } from './FunnelTable';
import { CycleTimeTable } from './CycleTimeTable';
import { WinRateCard } from './WinRateCard';
import { OutcomeDonut } from './OutcomeDonut';
import { AgingTable } from './AgingTable';

interface MetricsViewProps {
  items: RfpPipelineItem[];
  /** Injected for testability; defaults to the current time. */
  nowIso?: string;
  orgId: string;
  orgName: string;
  /** Aging threshold in days (default 7). */
  agingThresholdDays?: number;
}

const DEFAULT_WEEKS = 8;

/**
 * The METRICS tab body. Owns the filter state (date-range preset + owner) and
 * derives every metric client-side from the same pipeline fetch the other tabs
 * use. All computation lives in ../lib/derive-metrics; this component is layout.
 */
export const MetricsView = ({
  items,
  nowIso,
  orgName,
  agingThresholdDays = 7,
}: MetricsViewProps) => {
  const now = nowIso ?? new Date().toISOString();
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [assigneeName, setAssigneeName] = useState<string | undefined>(undefined);

  const owners = useMemo(() => ownerOptions(items), [items]);
  const range = useMemo(() => lastNWeeksRange(now, weeks), [now, weeks]);

  // Owner-filtered working set; date scoping is applied per metric.
  const scoped = useMemo(() => filterItems(items, { assigneeName }), [items, assigneeName]);

  const throughput = useMemo(
    () => throughputByWeek(scoped, range.startIso, range.endIso),
    [scoped, range],
  );
  const funnelRows = useMemo(() => funnel(scoped), [scoped]);
  const cycle = useMemo(() => cycleTime(scoped, range.startIso, range.endIso), [scoped, range]);
  const win = useMemo(() => winRate(scoped, range.startIso, range.endIso), [scoped, range]);
  const outcomes = useMemo(
    () => outcomeBreakdown(scoped, range.startIso, range.endIso),
    [scoped, range],
  );
  const agingRows = useMemo(
    () => aging(scoped, now, agingThresholdDays),
    [scoped, now, agingThresholdDays],
  );

  return (
    <div className="space-y-4">
      <MetricsFilters
        weeks={weeks}
        onWeeksChange={setWeeks}
        assigneeName={assigneeName}
        onAssigneeChange={setAssigneeName}
        owners={owners}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ThroughputChart data={throughput} onExport={() => exportThroughputCsv(throughput, orgName)} />
        <OutcomeDonut slices={outcomes} onExport={() => exportOutcomeCsv(outcomes, orgName)} />
        <FunnelTable rows={funnelRows} onExport={() => exportFunnelCsv(funnelRows, orgName)} />
        <CycleTimeTable summary={cycle} weeks={weeks} onExport={() => exportCycleTimeCsv(cycle, orgName)} />
        <WinRateCard result={win} />
        <div className="lg:col-span-2">
          <AgingTable
            rows={agingRows}
            thresholdDays={agingThresholdDays}
            onExport={() => exportAgingCsv(agingRows, orgName)}
          />
        </div>
      </div>
    </div>
  );
};
