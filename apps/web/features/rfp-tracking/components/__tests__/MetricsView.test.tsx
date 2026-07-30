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
    Bar: () => null,
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

const fixtureItems = () => [
  makeItem({
    id: 'won',
    title: 'Won RFP',
    assigneeId: 'u1',
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
    assigneeId: 'u2',
    assigneeName: 'Bob',
    pipelineStage: 'inProgress',
    approvalStatus: 'I_APPROVED',
    approvalHistory: [approvalTransition('I_APPROVED', '2026-07-01T00:00:00.000Z')],
  }),
];

describe('MetricsView', () => {
  it('renders all six metric cards', () => {
    render(<MetricsView items={fixtureItems()} nowIso={NOW} orgId="org-1" orgName="Acme" />);
    expect(screen.getByText('Throughput')).toBeTruthy();
    expect(screen.getByText('Funnel')).toBeTruthy();
    expect(screen.getByText('Cycle Time')).toBeTruthy();
    expect(screen.getByText('Win Rate')).toBeTruthy();
    expect(screen.getByText('Outcome Breakdown')).toBeTruthy();
    expect(screen.getByText('Aging')).toBeTruthy();
  });

  it('renders the win-rate raw counts', () => {
    render(<MetricsView items={fixtureItems()} nowIso={NOW} orgId="org-1" orgName="Acme" />);
    expect(screen.getByText(/of 1 submitted/i)).toBeTruthy();
  });

  it('renders without crashing on empty input and shows empty-state copy', () => {
    render(<MetricsView items={[]} nowIso={NOW} orgId="org-1" orgName="Acme" />);
    // All cards still render. Throughput seeds dense zero-count weeks, so the
    // chart renders; the outcome donut and aging table show their empty copy.
    expect(screen.getByText('Throughput')).toBeTruthy();
    expect(screen.getByText(/No outcomes in this period/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is aging past 7 days/i)).toBeTruthy();
    // Win rate with nothing submitted → 0 of 0.
    expect(screen.getByText(/0 of 0 submitted/i)).toBeTruthy();
  });

  it('exports the throughput CSV when its button is clicked', () => {
    render(<MetricsView items={fixtureItems()} nowIso={NOW} orgId="org-1" orgName="Acme" />);
    const throughputCard = screen.getByText('Throughput').closest('[data-slot="card"]') as HTMLElement;
    const exportBtn = within(throughputCard).getByRole('button', { name: /export csv/i });
    fireEvent.click(exportBtn);
    expect(csv.exportThroughputCsv).toHaveBeenCalledTimes(1);
  });

  it('recomputes when the owner filter changes', () => {
    render(<MetricsView items={fixtureItems()} nowIso={NOW} orgId="org-1" orgName="Acme" />);

    // Baseline win rate reflects both submitted items in window (only 'won').
    expect(screen.getByText(/1 of 1 submitted/i)).toBeTruthy();

    // Switch owner to Bob (u2) — Bob's RFP was never submitted → 0 of 0.
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Bob' }));

    expect(screen.getByText(/0 of 0 submitted/i)).toBeTruthy();
  });
});
