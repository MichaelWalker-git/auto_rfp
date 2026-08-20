import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockRevert = jest.fn();
let mockVersions: Array<Record<string, unknown>> = [];
let mockLoading = false;

jest.mock('../../hooks/useQuestionnaireVersions', () => ({
  useQuestionnaireVersions: () => ({
    versions: mockVersions,
    count: mockVersions.length,
    isLoading: mockLoading,
    error: null,
    revert: mockRevert,
    refresh: jest.fn(),
  }),
}));

import { QuestionnaireVersionHistory } from '../QuestionnaireVersionHistory';

const props = { orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd' };

beforeEach(() => {
  jest.clearAllMocks();
  mockLoading = false;
  mockVersions = [
    {
      versionId: 'v2',
      versionNumber: 2,
      source: 'AI_MASS_EDIT',
      createdAt: '2026-08-13T00:00:00.000Z',
      createdByName: 'Jane',
      snapshotFileKey: 'k2',
    },
    {
      versionId: 'v1',
      versionNumber: 1,
      source: 'MANUAL',
      createdAt: '2026-08-12T00:00:00.000Z',
      snapshotFileKey: 'k1',
    },
  ];
});

describe('QuestionnaireVersionHistory', () => {
  it('lists versions with source labels and Restore buttons', () => {
    render(<QuestionnaireVersionHistory {...props} />);
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText('AI mass edit')).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('Manual edit')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /restore/i })).toHaveLength(2);
  });

  it('shows a loading skeleton while loading', () => {
    mockLoading = true;
    mockVersions = [];
    const { container } = render(<QuestionnaireVersionHistory {...props} />);
    // Skeletons render as divs with the skeleton styling; assert no empty-state text.
    expect(screen.queryByText(/No version history yet/i)).toBeNull();
    expect(container.querySelector('.space-y-2')).toBeTruthy();
  });

  it('reverts to the chosen version and fires onReverted', async () => {
    mockRevert.mockResolvedValueOnce(undefined);
    const onReverted = jest.fn();
    render(<QuestionnaireVersionHistory {...props} onReverted={onReverted} />);
    // The first Restore button belongs to v2 (newest first).
    fireEvent.click(screen.getAllByRole('button', { name: /restore/i })[0]);
    await waitFor(() => expect(mockRevert).toHaveBeenCalledWith(2));
    await waitFor(() => expect(onReverted).toHaveBeenCalled());
  });

  it('shows an empty state with no versions', () => {
    mockVersions = [];
    render(<QuestionnaireVersionHistory {...props} />);
    expect(screen.getByText(/No version history yet/i)).toBeTruthy();
  });
});
