import { renderHook, waitFor } from '@testing-library/react';
import { useSolutionPlanHtmlContent } from '../useSolutionPlanHtmlContent';
import { mockApiFetcher, swrWrapper as wrapper } from './test-utils';

jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);

const htmlResponse = {
  ok: true,
  html: '<h1>Solution Plan</h1>',
  contentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
  version: 2,
  isStale: false,
  isUserEdited: false,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useSolutionPlanHtmlContent', () => {
  it('returns the HTML body from the html-content endpoint', async () => {
    mockApiFetcher.mockResolvedValue(htmlResponse);

    const { result } = renderHook(
      () => useSolutionPlanHtmlContent('org-1', 'proj-1', 'opp-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.content).not.toBeNull());
    expect(mockApiFetcher).toHaveBeenCalledWith(
      'https://api.test/solution-plan/html-content?orgId=org-1&projectId=proj-1&opportunityId=opp-1',
    );
    expect(result.current.content?.html).toBe('<h1>Solution Plan</h1>');
    expect(result.current.content?.version).toBe(2);
    expect(result.current.notFound).toBe(false);
  });

  it('does not fetch when disabled', () => {
    const { result } = renderHook(
      () => useSolutionPlanHtmlContent('org-1', 'proj-1', 'opp-1', { enabled: false }),
      { wrapper },
    );

    expect(mockApiFetcher).not.toHaveBeenCalled();
    expect(result.current.content).toBeNull();
  });

  it('does not fetch until all identifiers are present', () => {
    const { result } = renderHook(
      () => useSolutionPlanHtmlContent(undefined, 'proj-1', 'opp-1'),
      { wrapper },
    );

    expect(mockApiFetcher).not.toHaveBeenCalled();
    expect(result.current.content).toBeNull();
  });

  it('treats a 404 as "no content yet", not an error', async () => {
    mockApiFetcher.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));

    const { result } = renderHook(
      () => useSolutionPlanHtmlContent('org-1', 'proj-1', 'opp-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.content).toBeNull();
    expect(result.current.error).toBeUndefined();
  });
});
