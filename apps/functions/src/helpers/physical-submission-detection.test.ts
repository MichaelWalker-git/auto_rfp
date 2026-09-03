const mockScanPhysicalSubmission = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  scanPhysicalSubmission: (...args: unknown[]) => mockScanPhysicalSubmission(...args),
}));

const mockGetOpportunity = jest.fn();
const mockUpdateOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  updateOpportunity: (...args: unknown[]) => mockUpdateOpportunity(...args),
}));

const mockSyncPhysicalSubmissionLabel = jest.fn();
jest.mock('@/helpers/linear', () => ({
  syncPhysicalSubmissionLabel: (...args: unknown[]) => mockSyncPhysicalSubmissionLabel(...args),
}));

import { detectAndPersistPhysicalSubmission } from './physical-submission-detection';

const BASE_ARGS = {
  orgId: 'org-1',
  projectId: 'project-1',
  oppId: 'opp-1',
  rawText: 'Proposals must be mailed to the address below.',
};

describe('detectAndPersistPhysicalSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpportunity.mockResolvedValue({ item: { noticeId: 'HOR-42' } });
    mockUpdateOpportunity.mockResolvedValue(undefined);
    mockSyncPhysicalSubmissionLabel.mockResolvedValue(undefined);
  });

  it('is a no-op when the scan finds nothing and no valid LLM fallback is given', async () => {
    mockScanPhysicalSubmission.mockReturnValue(null);

    await detectAndPersistPhysicalSubmission(BASE_ARGS);

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    expect(mockSyncPhysicalSubmissionLabel).not.toHaveBeenCalled();
  });

  it('persists the deterministic scan result and syncs the Linear label', async () => {
    mockScanPhysicalSubmission.mockReturnValue({
      submissionMethod: 'PHYSICAL',
      submissionMailingAddress: null,
      submissionMethodRationale: 'mail proposals to the address below',
    });

    await detectAndPersistPhysicalSubmission(BASE_ARGS);

    expect(mockUpdateOpportunity).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      oppId: 'opp-1',
      patch: {
        submissionMethod: 'PHYSICAL',
        submissionMailingAddress: null,
        submissionMethodRationale: 'mail proposals to the address below',
      },
    });
    expect(mockSyncPhysicalSubmissionLabel).toHaveBeenCalledWith('opp-1', 'HOR-42', 'PHYSICAL');
  });

  it('falls back to the LLM-extracted value when the scan returns null', async () => {
    mockScanPhysicalSubmission.mockReturnValue(null);

    await detectAndPersistPhysicalSubmission({
      ...BASE_ARGS,
      llmSubmissionMethod: 'PHYSICAL',
      llmSubmissionRationale: 'LLM found mailing instructions',
    });

    expect(mockUpdateOpportunity).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      oppId: 'opp-1',
      patch: {
        submissionMethod: 'PHYSICAL',
        submissionMailingAddress: null,
        submissionMethodRationale: 'LLM found mailing instructions',
      },
    });
  });

  it('ignores an invalid LLM fallback value', async () => {
    mockScanPhysicalSubmission.mockReturnValue(null);

    await detectAndPersistPhysicalSubmission({
      ...BASE_ARGS,
      llmSubmissionMethod: 'NOT_A_REAL_VALUE',
    });

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('auto-fills an empty FOIA contact address from the extracted mailing address', async () => {
    mockGetOpportunity.mockResolvedValue({ item: { noticeId: 'HOR-42', foiaContactAddress: null } });
    mockScanPhysicalSubmission.mockReturnValue({
      submissionMethod: 'PHYSICAL',
      submissionMailingAddress: {
        addressLine1: '123 Main St',
        locality: 'Arlington',
        administrativeArea: 'VA',
        postalCode: '22201',
      },
      submissionMethodRationale: 'mail proposals to the address below',
    });

    await detectAndPersistPhysicalSubmission(BASE_ARGS);

    expect(mockUpdateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ foiaContactAddress: '123 Main St, Arlington, VA 22201' }),
      }),
    );
  });

  it('does not overwrite an existing FOIA contact address', async () => {
    mockGetOpportunity.mockResolvedValue({ item: { noticeId: 'HOR-42', foiaContactAddress: '456 Existing Ave' } });
    mockScanPhysicalSubmission.mockReturnValue({
      submissionMethod: 'PHYSICAL',
      submissionMailingAddress: {
        addressLine1: '123 Main St',
        locality: 'Arlington',
        administrativeArea: 'VA',
        postalCode: '22201',
      },
      submissionMethodRationale: 'mail proposals to the address below',
    });

    await detectAndPersistPhysicalSubmission(BASE_ARGS);

    const patch = mockUpdateOpportunity.mock.calls[0][0].patch;
    expect(patch).not.toHaveProperty('foiaContactAddress');
  });

  it('never throws when the scanner throws', async () => {
    mockScanPhysicalSubmission.mockImplementation(() => {
      throw new Error('scanner exploded');
    });

    await expect(detectAndPersistPhysicalSubmission(BASE_ARGS)).resolves.toBeUndefined();
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('never throws when persistence fails', async () => {
    mockScanPhysicalSubmission.mockReturnValue({
      submissionMethod: 'PHYSICAL',
      submissionMailingAddress: null,
      submissionMethodRationale: 'mail proposals to the address below',
    });
    mockUpdateOpportunity.mockRejectedValue(new Error('DynamoDB unavailable'));

    await expect(detectAndPersistPhysicalSubmission(BASE_ARGS)).resolves.toBeUndefined();
    expect(mockSyncPhysicalSubmissionLabel).not.toHaveBeenCalled();
  });
});
