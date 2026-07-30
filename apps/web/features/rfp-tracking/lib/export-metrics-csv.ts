import type {
  ThroughputBucket,
  FunnelRow,
  CycleTimeSummary,
  OutcomeSlice,
  AgingRow,
} from './derive-metrics';
import { csvCell } from './csv';

/**
 * export-metrics-csv.ts
 *
 * One client-side CSV export per metrics TABLE (acceptance criterion #7),
 * mirroring the Blob/URL download pattern in ./export-csv.ts.
 */

// Re-exported for existing importers/tests; the implementation lives in ./csv.
export { csvCell };

const round1 = (value: number | null): string => (value === null ? '' : value.toFixed(1));

/** Slugify an org name for a filename segment. */
const slug = (orgName: string): string => orgName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'export';

/** Serialize rows to CSV text and trigger a browser download. */
const downloadCsv = (rows: string[][], filename: string): void => {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportThroughputCsv = (buckets: ThroughputBucket[], orgName: string): void => {
  const rows: string[][] = [
    ['Week Starting', 'Submitted'],
    ...buckets.map((b) => [b.weekStartIso, String(b.count)]),
  ];
  downloadCsv(rows, `rfp-throughput-${slug(orgName)}.csv`);
};

export const exportFunnelCsv = (funnelRows: FunnelRow[], orgName: string): void => {
  const rows: string[][] = [
    ['Stage', 'Entered', 'Conversion From Previous (%)'],
    ...funnelRows.map((r) => [
      r.label,
      String(r.entered),
      r.conversionFromPrev === null ? '' : r.conversionFromPrev.toFixed(1),
    ]),
  ];
  downloadCsv(rows, `rfp-funnel-${slug(orgName)}.csv`);
};

export const exportCycleTimeCsv = (summary: CycleTimeSummary, orgName: string): void => {
  const rows: string[][] = [
    ['Stage', 'Avg Days', 'Median Days', 'Sample Size'],
    ...summary.perStage.map((r) => [
      r.label,
      round1(r.avgDays),
      round1(r.medianDays),
      String(r.n),
    ]),
    [
      'Total (Found → Submitted)',
      round1(summary.foundToSubmitted.avgDays),
      round1(summary.foundToSubmitted.medianDays),
      String(summary.foundToSubmitted.n),
    ],
  ];
  downloadCsv(rows, `rfp-cycle-time-${slug(orgName)}.csv`);
};

export const exportOutcomeCsv = (slices: OutcomeSlice[], orgName: string): void => {
  const rows: string[][] = [
    ['Outcome', 'Count'],
    ...slices.map((s) => [s.label, String(s.count)]),
  ];
  downloadCsv(rows, `rfp-outcomes-${slug(orgName)}.csv`);
};

export const exportAgingCsv = (agingRows: AgingRow[], orgName: string): void => {
  const rows: string[][] = [
    ['Title', 'Opportunity ID', 'Stage', 'Owner', 'Days In Stage'],
    ...agingRows.map((r) => [
      r.item.title ?? '',
      r.item.oppId ?? r.item.id,
      r.label,
      r.item.assigneeName ?? '',
      String(r.daysInStage),
    ]),
  ];
  downloadCsv(rows, `rfp-aging-${slug(orgName)}.csv`);
};
