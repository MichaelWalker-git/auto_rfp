import { render, screen, fireEvent, within } from '@testing-library/react';
import { MetricsView } from '../MetricsView';
import { makeItem, approvalTransition } from '../../__tests__/fixtures';

// Recharts renders to 0-size in jsdom and can warn/crash; stub the pieces we use
// so we assert on surrounding text/labels, not chart internals.
jest.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Passthrough,
    BarChart: Passthrough,
    Bar: Passthrough,
    LabelList: () => null,
    PieChart: Passthrough,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
  };
});

// Spy on the CSV exports so clicking a button is observable without a real download.
jest.mock('../../lib/export-metrics-csv', () => ({
  exportThroughputCsv: jest.fn(),
  exportFunnelCsv: jest.fn(),
  exportCycleTimeCsv: jest.fn(),
  exportOutcomeCsv: jest.fn(),
  exportAgingCsv: jest.fn(),
}));

import * as csv from '../../lib/export-metrics-csv';

const NOW = '2026-07-27T12:00:00.000Z';

// Linear-synced shape: assigneeId is always undefined, only assigneeName is set.
// This exercises the regression — the owner filter must key on name.
const fixtureItems = () => [
  makeItem({
    id: 'won',
    title: 'Won RFP',
    assigneeId: undefined,
    assigneeName: 'Amy',
    status: 'WON',
    pipelineStage: 'awarded',
    completedAt: '2026-07-20T00:00:00.000Z',
    approvalHistory: [
      approvalTransition('INITIAL_APPROVAL', '2026-07-10T00:00:00.000Z'),
      approvalTransition('I_APPROVED', '2026-07-12T00:00:00.000Z'),
      approvalTransition('SUBMITTED', '2026-07-18T00:00:00.000Z'),
    ],
  }),
  makeItem({
    id: 'open',
    title: 'Open RFP',
    assigneeId: undefined,
    assigneeName: 'Bob',
    pipelineStage: 'inProgress',
    approvalStatus: 'I_APPROVED',
    approvalHistory: [approvalTransition('I_APPROVED', '2026-07-01T00:00:00.000Z')],
  }),
];

describe('MetricsView', () => {
  it('renders all five metric cards', () => {
    render(<MetricsView items={fixtureItems()} nowIso={NOW} orgId="org-1" orgName="Acme" />);
    expect(screen.getByText('Throughput')).toBeTruthy();
    expect(screen.getByText('Funnel')).toBeTruthy();
    expect(screen.getByText('Cycle Time')).toBeTruthy();
    expect(screen.getByText('Outcome Breakdown')).toBeTruthy();
    expect(screen.getByText('Aging')).toBeTruthy();
  });

  it('renders without crashing on empty input and shows empty-state copy', () => {
    render(<MetricsView items={[]} nowIso={NOW} orgId="org-1" orgName="Acme" />);
    // All cards still render. Throughput seeds dense zero-count weeks, so the
    // chart renders; the outcome donut and aging table show their empty copy.
    expect(screen.getByText('Throughput')).toBeTruthy();
    expect(screen.getByText(/No outcomes in this period/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is aging past 7 days/i)).toBeTruthy();
  });

  it('exports the throughput CSV when its button is clicked', () => {
    render(<MetricsView items={fixtureItems()} nowIso={NOW} orgId="org-1" orgName="Acme" />);
    const throughputCard = screen.getByText('Throughput').closest('[data-slot="card"]') as HTMLElement;
    const exportBtn = within(throughputCard).getByRole('button', { name: /export csv/i });
    fireEvent.click(exportBtn);
    expect(csv.exportThroughputCsv).toHaveBeenCalledTimes(1);
  });

  it('populates the owner dropdown from assigneeName and recomputes on select', () => {
    render(<MetricsView items={fixtureItems()} nowIso={NOW} orgId="org-1" orgName="Acme" />);

    // Baseline: Bob's still-open RFP is aging (created ~26 days before NOW),
    // so the aging table lists it rather than showing its empty-state copy.
    expect(screen.queryByText(/Nothing is aging past 7 days/i)).toBeNull();
    expect(screen.getByText('Open RFP')).toBeTruthy();

    // The dropdown must populate from Linear-synced (name-only) items: both
    // owner names appear as options alongside "All owners".
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'All owners' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Amy' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Bob' })).toBeTruthy();

    // Switch owner to Amy (name-only, no assigneeId) — Amy's only RFP is the
    // terminal 'won' item, which never ages, so the aging table empties out.
    // This proves selecting by name filters the metrics.
    fireEvent.click(screen.getByRole('option', { name: 'Amy' }));
    expect(screen.getByText(/Nothing is aging past 7 days/i)).toBeTruthy();

    // And selecting Bob (the open-RFP owner) brings the aging row back.
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Bob' }));
    expect(screen.getByText('Open RFP')).toBeTruthy();
  });
});
