import { render, screen } from '@testing-library/react';
import {
  SolutionPlanGateCallout,
  SolutionPlanNudgeBanner,
  buildSolutionPlanEditorHref,
  buildSolutionPlanSectionHref,
} from '../SolutionPlanGateCallout';

const ids = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

describe('SolutionPlanGateCallout', () => {
  it('renders the "create a plan" variant by default, linking to the plan section', () => {
    render(<SolutionPlanGateCallout {...ids} />);

    expect(screen.getByTestId('solution-plan-gate-callout')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Go to Solution Plan' });
    expect(link.getAttribute('href')).toBe(
      buildSolutionPlanSectionHref(ids.orgId, ids.projectId, ids.opportunityId),
    );
  });

  it('renders the no-bid explanation with an editor link for variant="no-bid"', () => {
    render(<SolutionPlanGateCallout {...ids} variant="no-bid" />);

    expect(screen.getByTestId('solution-plan-no-bid-callout')).toBeTruthy();
    expect(screen.getByText(/No-Bid decision/)).toBeTruthy();
    expect(screen.queryByTestId('solution-plan-gate-callout')).toBeNull();
    const link = screen.getByRole('link', { name: 'Open Solution Plan' });
    expect(link.getAttribute('href')).toBe(
      buildSolutionPlanEditorHref(ids.orgId, ids.projectId, ids.opportunityId),
    );
  });

  it('invokes onNavigate when the no-bid editor link is clicked', () => {
    const onNavigate = jest.fn();
    render(<SolutionPlanGateCallout {...ids} variant="no-bid" onNavigate={onNavigate} />);

    screen.getByRole('link', { name: 'Open Solution Plan' }).click();

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('SolutionPlanNudgeBanner', () => {
  it('renders the non-blocking recommendation with a create link', () => {
    render(<SolutionPlanNudgeBanner {...ids} />);

    expect(screen.getByTestId('solution-plan-nudge-banner')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a Solution Plan' })).toBeTruthy();
  });
});
