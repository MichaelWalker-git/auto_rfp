import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressTabStrip, type TabHeaderModel } from '../ProgressTabStrip';
import type { NavigationDescriptor, ProgressStep } from '../../lib/types';

const route = (href: string): NavigationDescriptor => ({ kind: 'route', href });

const stepTab = (key: string, label: string, step: Partial<ProgressStep>): TabHeaderModel => ({
  key,
  label,
  navigation: route(key),
  step: {
    stepId: 'solicitations',
    status: 'complete',
    detailText: '1 of 1 processed',
    label,
    navigation: route(key),
    visible: true,
    ...step,
  } as ProgressStep,
});

describe('ProgressTabStrip', () => {
  it('renders a tab per model with its label and metric', () => {
    const tabs: TabHeaderModel[] = [
      stepTab('details', 'Details', { detailText: '2 of 3 processed' }),
      { key: 'outcome', label: 'Outcome', navigation: route('outcome'), metricText: 'Awaiting outcome' },
    ];
    render(<ProgressTabStrip tabs={tabs} activeKey="details" onNavigate={jest.fn()} />);

    expect(screen.getByRole('tab', { name: /Details/ })).toBeInTheDocument();
    expect(screen.getByText('2 of 3 processed')).toBeInTheDocument();
    expect(screen.getByText('Awaiting outcome')).toBeInTheDocument();
  });

  it('marks the active tab selected', () => {
    const tabs = [stepTab('details', 'Details', {}), stepTab('analysis', 'Analysis', {})];
    render(<ProgressTabStrip tabs={tabs} activeKey="analysis" onNavigate={jest.fn()} />);

    expect(screen.getByRole('tab', { name: /Analysis/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('navigates with the tab descriptor when clicked', () => {
    const onNavigate = jest.fn();
    const tabs = [stepTab('details', 'Details', {}), stepTab('analysis', 'Analysis', {})];
    render(<ProgressTabStrip tabs={tabs} activeKey="details" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('tab', { name: /Analysis/ }));

    expect(onNavigate).toHaveBeenCalledWith({ kind: 'route', href: 'analysis' });
  });

  it('shows a busy skeleton while loading', () => {
    render(<ProgressTabStrip tabs={[]} activeKey="details" onNavigate={jest.fn()} isLoading />);

    expect(screen.getByRole('tablist')).toHaveAttribute('aria-busy', 'true');
  });
});
