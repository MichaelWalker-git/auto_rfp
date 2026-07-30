import {
  exportThroughputCsv,
  exportFunnelCsv,
  exportCycleTimeCsv,
  exportOutcomeCsv,
  exportAgingCsv,
} from '../export-metrics-csv';
import type {
  ThroughputBucket,
  FunnelRow,
  CycleTimeSummary,
  OutcomeSlice,
  AgingRow,
} from '../derive-metrics';
import { makeItem } from '../../__tests__/fixtures';

let lastBlobText = '';
let lastDownloadName = '';

beforeEach(() => {
  lastBlobText = '';
  lastDownloadName = '';

  global.URL.createObjectURL = jest.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = jest.fn();

  global.Blob = jest.fn((parts: string[]) => {
    lastBlobText = parts.join('');
    return { size: lastBlobText.length } as unknown as Blob;
  }) as unknown as typeof Blob;

  jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'a') {
      return {
        set href(_v: string) {},
        set download(v: string) {
          lastDownloadName = v;
        },
        click: jest.fn(),
      } as unknown as HTMLElement;
    }
    return {} as HTMLElement;
  }) as typeof document.createElement);

  jest.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
  jest.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
});

afterEach(() => jest.restoreAllMocks());

describe('exportThroughputCsv', () => {
  it('writes a header row plus a row per bucket', () => {
    const buckets: ThroughputBucket[] = [
      { weekStartIso: '2026-07-20T00:00:00.000Z', label: 'Jul 20', count: 2 },
    ];
    exportThroughputCsv(buckets, 'Acme Corp');
    const lines = lastBlobText.split('\n');
    expect(lines[0]).toContain('Week Starting');
    expect(lines[1]).toContain('2026-07-20');
    expect(lines[1]).toContain('2');
    expect(lastDownloadName).toBe('rfp-throughput-acme-corp.csv');
  });
});

describe('exportFunnelCsv', () => {
  it('serializes stage, entered and conversion', () => {
    const rows: FunnelRow[] = [
      { stage: 'execSummaryToReview', label: 'Initial Approval', entered: 3, conversionFromPrev: null },
      { stage: 'firstApproved', label: 'First approved', entered: 2, conversionFromPrev: 66.66 },
    ];
    exportFunnelCsv(rows, 'Acme');
    const lines = lastBlobText.split('\n');
    expect(lines[0]).toContain('Conversion From Previous');
    expect(lines[2]).toContain('66.7');
  });
});

describe('exportCycleTimeCsv', () => {
  it('includes per-stage rows and the total footer row', () => {
    const summary: CycleTimeSummary = {
      perStage: [{ stage: 'execSummaryToReview', label: 'Initial Approval', avgDays: 3, medianDays: 3, n: 2 }],
      foundToSubmitted: { avgDays: 9, medianDays: 9, n: 1 },
    };
    exportCycleTimeCsv(summary, 'Acme');
    expect(lastBlobText).toContain('Initial Approval');
    expect(lastBlobText).toContain('Found → Submitted');
    expect(lastBlobText).toContain('9.0');
  });
});

describe('exportOutcomeCsv', () => {
  it('writes each outcome with its count', () => {
    const slices: OutcomeSlice[] = [
      { key: 'awarded', label: 'Awarded', count: 1, color: '#10b981' },
      { key: 'pending', label: 'Pending', count: 4, color: '#6366f1' },
    ];
    exportOutcomeCsv(slices, 'Acme');
    expect(lastBlobText).toContain('Awarded');
    expect(lastBlobText).toContain('Pending');
  });
});

describe('exportAgingCsv', () => {
  it('serializes item fields and escapes quotes', () => {
    const rows: AgingRow[] = [
      { item: makeItem({ title: 'The "Big" RFP' }), stage: 'inProgress', label: 'In progress', daysInStage: 12 },
    ];
    exportAgingCsv(rows, 'Acme');
    expect(lastBlobText).toContain('"The ""Big"" RFP"');
    expect(lastBlobText).toContain('12');
  });
});
