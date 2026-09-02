import { renderHook, waitFor } from '@testing-library/react';
import type { SolutionPlanVersionContentResponse } from '@auto-rfp/core';
import { useVersionContent } from '../useVersionContent';
import { makeVersion, mockApiFetcher, swrWrapper as wrapper } from './test-utils';

jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);

const contentResponse: SolutionPlanVersionContentResponse = {
  ok: true,
  html: '<h1>Old plan body</h1>',
  version: makeVersion({ versionId: 'ver-1' }),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useVersionContent', () => {
  it('fetches the version body when a versionId is supplied', async () => {
    mockApiFetcher.mockResolvedValue(contentResponse);

    const { result } = renderHook(
      () => useVersionContent('org-1', 'proj-1', 'opp-1', 'ver-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.content).not.toBeNull());
    expect(mockApiFetcher).toHaveBeenCalledWith(
      'https://api.test/solution-plan/version/content?orgId=org-1&projectId=proj-1&opportunityId=opp-1&versionId=ver-1',
    );
    expect(result.current.content?.html).toBe('<h1>Old plan body</h1>');
    expect(result.current.content?.version.versionId).toBe('ver-1');
    expect(result.current.notFound).toBe(false);
  });

  it('does not fetch while the modal is closed (versionId null)', () => {
    const { result } = renderHook(
      () => useVersionContent('org-1', 'proj-1', 'opp-1', null),
      { wrapper },
    );

    expect(mockApiFetcher).not.toHaveBeenCalled();
    expect(result.current.content).toBeNull();
  });

  it('surfaces a vanished version (404) as notFound, not error', async () => {
    mockApiFetcher.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));

    const { result } = renderHook(
      () => useVersionContent('org-1', 'proj-1', 'opp-1', 'ver-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.content).toBeNull();
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces other load failures as error with retry available', async () => {
    mockApiFetcher.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

    const { result } = renderHook(
      () => useVersionContent('org-1', 'proj-1', 'opp-1', 'ver-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.notFound).toBe(false);
    expect(typeof result.current.retry).toBe('function');
  });
});
