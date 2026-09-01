const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: (...a: unknown[]) => mockGetApiKey(...a),
}));

const mockUpdateIssue = jest.fn();
const mockIssues = jest.fn();
const mockTeam = jest.fn();

jest.mock('@linear/sdk', () => ({
  LinearClient: jest.fn().mockImplementation(() => ({
    issues: (...a: unknown[]) => mockIssues(...a),
    team: (...a: unknown[]) => mockTeam(...a),
    updateIssue: (...a: unknown[]) => mockUpdateIssue(...a),
  })),
}));

import {
  addLinearLabelByIdentifier,
  removeLinearLabelByIdentifier,
  syncPhysicalSubmissionLabel,
  PHYSICAL_SUBMISSION_LABEL,
} from './linear';

const EXISTING_LABEL_ID = 'label-existing';
const TARGET_LABEL_ID = 'label-physical';

const makeIssue = (labelIds: string[]) => ({
  id: 'issue-uuid',
  identifier: 'HOR-42',
  team: Promise.resolve({ id: 'team-uuid' }),
  labels: () =>
    Promise.resolve({ nodes: labelIds.map((id) => ({ id, name: `label-${id}` })) }),
});

const makeTeamLabels = (extraLabel?: { id: string; name: string }) => ({
  nodes: [
    { id: EXISTING_LABEL_ID, name: 'existing' },
    { id: TARGET_LABEL_ID, name: PHYSICAL_SUBMISSION_LABEL },
    ...(extraLabel ? [extraLabel] : []),
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetApiKey.mockResolvedValue('test-api-key');
  mockTeam.mockResolvedValue({ labels: () => Promise.resolve(makeTeamLabels()) });
  mockUpdateIssue.mockResolvedValue({});
  process.env.RFP_SYNC_LINEAR_ORG_ID = 'linear-org-1';
});

afterEach(() => {
  delete process.env.RFP_SYNC_LINEAR_ORG_ID;
});

describe('addLinearLabelByIdentifier', () => {
  it('adds the target label without removing existing ones', async () => {
    mockIssues.mockResolvedValue({ nodes: [makeIssue([EXISTING_LABEL_ID])] });

    await addLinearLabelByIdentifier('org-1', 'HOR-42', PHYSICAL_SUBMISSION_LABEL);

    expect(mockUpdateIssue).toHaveBeenCalledWith('issue-uuid', {
      labelIds: expect.arrayContaining([EXISTING_LABEL_ID, TARGET_LABEL_ID]),
    });
    const [, { labelIds }] = mockUpdateIssue.mock.calls[0];
    expect(labelIds).toHaveLength(2);
  });

  it('does not duplicate a label already present', async () => {
    mockIssues.mockResolvedValue({ nodes: [makeIssue([EXISTING_LABEL_ID, TARGET_LABEL_ID])] });

    await addLinearLabelByIdentifier('org-1', 'HOR-42', PHYSICAL_SUBMISSION_LABEL);

    const [, { labelIds }] = mockUpdateIssue.mock.calls[0];
    expect(labelIds).toHaveLength(2);
  });

  it('swallows Linear API errors and does not throw', async () => {
    mockIssues.mockRejectedValue(new Error('Linear unavailable'));

    await expect(
      addLinearLabelByIdentifier('org-1', 'HOR-42', PHYSICAL_SUBMISSION_LABEL),
    ).resolves.toBeUndefined();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it('is a no-op when the issue is not found', async () => {
    mockIssues.mockResolvedValue({ nodes: [] });

    await addLinearLabelByIdentifier('org-1', 'HOR-42', PHYSICAL_SUBMISSION_LABEL);

    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });
});

describe('removeLinearLabelByIdentifier', () => {
  it('removes only the target label, leaving others intact', async () => {
    mockIssues.mockResolvedValue({
      nodes: [makeIssue([EXISTING_LABEL_ID, TARGET_LABEL_ID])],
    });

    await removeLinearLabelByIdentifier('org-1', 'HOR-42', PHYSICAL_SUBMISSION_LABEL);

    expect(mockUpdateIssue).toHaveBeenCalledWith('issue-uuid', {
      labelIds: [EXISTING_LABEL_ID],
    });
  });

  it('is a no-op (no updateIssue) when label is not in team list', async () => {
    mockIssues.mockResolvedValue({ nodes: [makeIssue([EXISTING_LABEL_ID])] });
    mockTeam.mockResolvedValue({
      labels: () => Promise.resolve({ nodes: [{ id: EXISTING_LABEL_ID, name: 'existing' }] }),
    });

    await removeLinearLabelByIdentifier('org-1', 'HOR-42', 'nonexistent-label');

    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it('swallows Linear API errors and does not throw', async () => {
    mockIssues.mockRejectedValue(new Error('network error'));

    await expect(
      removeLinearLabelByIdentifier('org-1', 'HOR-42', PHYSICAL_SUBMISSION_LABEL),
    ).resolves.toBeUndefined();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it('is a no-op when the issue is not found', async () => {
    mockIssues.mockResolvedValue({ nodes: [] });

    await removeLinearLabelByIdentifier('org-1', 'HOR-42', PHYSICAL_SUBMISSION_LABEL);

    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });
});

describe('syncPhysicalSubmissionLabel', () => {
  it('calls addLinearLabelByIdentifier when submissionMethod is PHYSICAL', async () => {
    mockIssues.mockResolvedValue({ nodes: [makeIssue([EXISTING_LABEL_ID])] });

    await syncPhysicalSubmissionLabel('linear-hor-42', 'HOR-42', 'PHYSICAL');

    expect(mockGetApiKey).toHaveBeenCalledWith('linear-org-1', expect.anything());
    expect(mockIssues).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { number: { eq: 42 } } }),
    );
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      'issue-uuid',
      expect.objectContaining({ labelIds: expect.arrayContaining([TARGET_LABEL_ID]) }),
    );
  });

  it('calls addLinearLabelByIdentifier when submissionMethod is BOTH', async () => {
    mockIssues.mockResolvedValue({ nodes: [makeIssue([EXISTING_LABEL_ID])] });

    await syncPhysicalSubmissionLabel('linear-hor-42', 'HOR-42', 'BOTH');

    expect(mockUpdateIssue).toHaveBeenCalledWith(
      'issue-uuid',
      expect.objectContaining({ labelIds: expect.arrayContaining([TARGET_LABEL_ID]) }),
    );
  });

  it('calls removeLinearLabelByIdentifier when submissionMethod is ELECTRONIC', async () => {
    mockIssues.mockResolvedValue({
      nodes: [makeIssue([EXISTING_LABEL_ID, TARGET_LABEL_ID])],
    });

    await syncPhysicalSubmissionLabel('linear-hor-42', 'HOR-42', 'ELECTRONIC');

    expect(mockUpdateIssue).toHaveBeenCalledWith('issue-uuid', {
      labelIds: [EXISTING_LABEL_ID],
    });
  });

  it('is a no-op for non-linear- oppIds', async () => {
    await syncPhysicalSubmissionLabel('sam-ABC123', 'HOR-42', 'PHYSICAL');

    expect(mockIssues).not.toHaveBeenCalled();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it('is a no-op when noticeId is missing', async () => {
    await syncPhysicalSubmissionLabel('linear-hor-42', null, 'PHYSICAL');

    expect(mockIssues).not.toHaveBeenCalled();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it('is a no-op when RFP_SYNC_LINEAR_ORG_ID is not configured', async () => {
    delete process.env.RFP_SYNC_LINEAR_ORG_ID;

    await syncPhysicalSubmissionLabel('linear-hor-42', 'HOR-42', 'PHYSICAL');

    expect(mockIssues).not.toHaveBeenCalled();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });
});
