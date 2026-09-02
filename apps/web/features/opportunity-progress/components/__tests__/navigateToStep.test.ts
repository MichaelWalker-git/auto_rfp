// Mock the data hook so importing the host component doesn't pull in the whole
// solution-plan → employees → nuqs (ESM) chain, which jest doesn't transform.
jest.mock('../../hooks/useOpportunityProgress', () => ({
  useOpportunityProgress: () => ({ steps: [], isLoading: false }),
}));

import { navigateToStep } from '../OpportunityProgressBar';

describe('navigateToStep', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('smooth-scrolls to the anchor section element', () => {
    const el = document.createElement('section');
    el.id = 'executive-brief';
    const scrollIntoView = jest.fn();
    el.scrollIntoView = scrollIntoView;
    document.body.appendChild(el);

    navigateToStep({ kind: 'anchor', sectionId: 'executive-brief' });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('does nothing when the anchor target is missing', () => {
    expect(() => navigateToStep({ kind: 'anchor', sectionId: 'does-not-exist' })).not.toThrow();
  });
});
