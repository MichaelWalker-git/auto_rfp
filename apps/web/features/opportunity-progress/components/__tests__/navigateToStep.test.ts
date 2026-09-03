import { navigateToStep } from '../OpportunityProgressBar';

describe('navigateToStep', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('selects the owning tab for a route descriptor (the tab reorg path)', () => {
    const selectTab = jest.fn();

    navigateToStep({ kind: 'route', href: 'analysis' }, selectTab);

    expect(selectTab).toHaveBeenCalledWith('analysis');
  });

  it('does not scroll when navigating by tab route', () => {
    const el = document.createElement('section');
    el.id = 'analysis';
    const scrollIntoView = jest.fn();
    el.scrollIntoView = scrollIntoView;
    document.body.appendChild(el);

    navigateToStep({ kind: 'route', href: 'analysis' }, jest.fn());

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('smooth-scrolls to the anchor section element (legacy descriptor)', () => {
    const el = document.createElement('section');
    el.id = 'executive-brief';
    const scrollIntoView = jest.fn();
    el.scrollIntoView = scrollIntoView;
    document.body.appendChild(el);

    navigateToStep({ kind: 'anchor', sectionId: 'executive-brief' }, jest.fn());

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('does nothing when the anchor target is missing', () => {
    expect(() =>
      navigateToStep({ kind: 'anchor', sectionId: 'does-not-exist' }, jest.fn()),
    ).not.toThrow();
  });
});
