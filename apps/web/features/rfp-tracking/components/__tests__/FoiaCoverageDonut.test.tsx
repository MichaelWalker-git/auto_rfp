import { render, screen, fireEvent } from '@testing-library/react';
import { FoiaCoverageDonut } from '../FoiaCoverageDonut';
import type { FoiaCoverageSlice } from '../../lib/derive-metrics';

const emptySlices: FoiaCoverageSlice[] = [
  { key: 'sent', label: 'Sent', count: 0, color: '#10b981' },
  { key: 'pending', label: 'Pending', count: 0, color: '#6366f1' },
  { key: 'blocked', label: 'Blocked / failed', count: 0, color: '#f59e0b' },
  { key: 'suppressed', label: 'Suppressed', count: 0, color: '#94a3b8' },
  { key: 'notStarted', label: 'Not started', count: 0, color: '#cbd5e1' },
];

const populatedSlices: FoiaCoverageSlice[] = [
  { key: 'sent', label: 'Sent', count: 3, color: '#10b981' },
  { key: 'pending', label: 'Pending', count: 1, color: '#6366f1' },
  { key: 'blocked', label: 'Blocked / failed', count: 2, color: '#f59e0b' },
  { key: 'suppressed', label: 'Suppressed', count: 0, color: '#94a3b8' },
  { key: 'notStarted', label: 'Not started', count: 4, color: '#cbd5e1' },
];

describe('FoiaCoverageDonut', () => {
  it('shows the empty state and disables export when total is zero', () => {
    const onExport = jest.fn();
    render(<FoiaCoverageDonut slices={emptySlices} onExport={onExport} />);

    expect(screen.getByText(/no foia-eligible rfps/i)).toBeTruthy();
    // The legend is inside the populated branch, so empty state renders the
    // message alone — no legend rows.
    for (const slice of emptySlices) {
      expect(screen.queryByText(slice.label)).toBeNull();
    }
    const exportBtn = screen.getByRole('button', { name: /export/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
    fireEvent.click(exportBtn);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('renders a legend row per slice with its count and a live export button', () => {
    const onExport = jest.fn();
    render(<FoiaCoverageDonut slices={populatedSlices} onExport={onExport} />);

    // Title + total in the description.
    expect(screen.getByText('FOIA Coverage')).toBeTruthy();
    expect(screen.getByText(/10 total/)).toBeTruthy();

    // Legend rows.
    for (const slice of populatedSlices) {
      expect(screen.getByText(slice.label)).toBeTruthy();
    }

    const exportBtn = screen.getByRole('button', { name: /export/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
    fireEvent.click(exportBtn);
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
