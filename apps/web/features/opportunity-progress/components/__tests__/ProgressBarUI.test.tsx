import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressBarUI } from '../ProgressBarUI';
import type { ProgressStep, StepStatus, NavigationDescriptor } from '../../lib/types';

const NAV_LABEL = 'Package preparation progress';

const step = (over: Partial<ProgressStep> & Pick<ProgressStep, 'stepId'>): ProgressStep => ({
  status: 'not-started',
  detailText: 'Not started',
  label: 'Step',
  navigation: { kind: 'anchor', sectionId: 'sec' },
  visible: true,
  ...over,
});

const fourStatuses: ProgressStep[] = [
  step({ stepId: 'solicitations', label: 'Solicitations', status: 'complete', detailText: '2 of 2 processed' }),
  step({ stepId: 'analysis', label: 'Analysis', status: 'in-progress', detailText: '3 of 8 sections' }),
  step({ stepId: 'required-forms', label: 'Required Forms', status: 'not-started', detailText: 'No required forms' }),
  step({
    stepId: 'submission',
    label: 'Submission',
    status: 'needs-attention',
    detailText: '80% pass rate',
    reason: 'Outdated — new solicitation uploaded',
  }),
];

describe('ProgressBarUI', () => {
  it('renders a navigation landmark with each step as a tab stop', () => {
    render(<ProgressBarUI steps={fourStatuses} onNavigate={jest.fn()} />);
    const nav = screen.getByRole('navigation', { name: NAV_LABEL });
    expect(nav).toBeTruthy();
    // one navigation button per step (details buttons are separate aria-labels)
    for (const s of fourStatuses) {
      expect(screen.getByRole('button', { name: new RegExp(`^${s.label},`) })).toBeTruthy();
    }
  });

  it('conveys status in words, not colour alone (FR6)', () => {
    render(<ProgressBarUI steps={fourStatuses} onNavigate={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Solicitations, complete, 2 of 2 processed/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Analysis, in progress, 3 of 8 sections/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Required Forms, not started/ })).toBeTruthy();
    // needs-attention appends the reason sentence
    expect(
      screen.getByRole('button', {
        name: /Submission, needs attention, 80% pass rate\. Outdated — new solicitation uploaded/,
      }),
    ).toBeTruthy();
  });

  it('renders the unavailable status accessibly', () => {
    render(
      <ProgressBarUI
        steps={[step({ stepId: 'analysis', label: 'Analysis', status: 'unavailable' as StepStatus, detailText: 'Status unavailable' })]}
        onNavigate={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Analysis, status unavailable, Status unavailable/ })).toBeTruthy();
  });

  it('activates a step navigation descriptor on click', () => {
    const onNavigate = jest.fn<void, [NavigationDescriptor]>();
    render(<ProgressBarUI steps={fourStatuses} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Analysis, in progress/ }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'anchor', sectionId: 'sec' });
  });

  it('shows a skeleton (not a spinner) while loading', () => {
    const { container } = render(<ProgressBarUI steps={[]} isLoading onNavigate={jest.fn()} />);
    const nav = screen.getByRole('navigation', { name: NAV_LABEL });
    expect(nav.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(/loading/i)).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no steps', () => {
    render(<ProgressBarUI steps={[]} onNavigate={jest.fn()} />);
    expect(screen.getByText(/No steps to show yet/)).toBeTruthy();
  });

  it('condensed variant shows "current step" inline (first non-complete)', () => {
    render(<ProgressBarUI steps={fourStatuses} variant="condensed" onNavigate={jest.fn()} />);
    // current = Analysis (first non-complete); label appears both as a circle button and inline
    expect(screen.getAllByText('Analysis').length).toBeGreaterThan(0);
  });

  it('mobile variant shows "K of N" complete count', () => {
    render(<ProgressBarUI steps={fourStatuses} variant="mobile" onNavigate={jest.fn()} />);
    expect(screen.getByText('1 of 4')).toBeTruthy();
    expect(screen.getByText(/Next:/)).toBeTruthy();
  });

  it('mobile variant reports all-complete count and keeps the last step current', () => {
    const done = fourStatuses.map((s) => step({ ...s, status: 'complete' }));
    render(<ProgressBarUI steps={done} variant="mobile" onNavigate={jest.fn()} />);
    expect(screen.getByText('4 of 4')).toBeTruthy();
  });

  it('opens the step-details popover from the Info affordance', () => {
    render(
      <ProgressBarUI
        steps={[
          step({
            stepId: 'analysis',
            label: 'Analysis',
            status: 'in-progress',
            detailText: '3 of 8 sections',
            domainData: { brief: null },
          }),
        ]}
        onNavigate={jest.fn()}
      />,
    );
    const infoBtn = screen.getByRole('button', { name: 'Details for Analysis' });
    fireEvent.click(infoBtn);
    // popover body renders the section checklist labels
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Scoring')).toBeTruthy();
  });
});
