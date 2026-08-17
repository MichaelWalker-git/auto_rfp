import { render, screen } from '@testing-library/react';
import {
  SolutionPlanGateCallout,
  SolutionPlanNudgeBanner,
  buildSolutionPlanSectionHref,
} from '../SolutionPlanGateCallout';

const ids = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

describe('SolutionPlanGateCallout', () => {
  it('renders the blocked callout linking to the plan section', () => {
    render(<SolutionPlanGateCallout {...ids} />);

    expect(screen.getByTestId('solution-plan-gate-callout')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Go to Solution Plan' });
    expect(link.getAttribute('href')).toBe(
      buildSolutionPlanSectionHref(ids.orgId, ids.projectId, ids.opportunityId),
    );
  });

  it('invokes onNavigate when the link is clicked', () => {
    const onNavigate = jest.fn();
    render(<SolutionPlanGateCallout {...ids} onNavigate={onNavigate} />);

    screen.getByRole('link', { name: 'Go to Solution Plan' }).click();

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
