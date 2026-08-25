/**
 * Tests for enqueueDriveFolderForBrief (HOR-2729 §2): on-demand, idempotent
 * enqueue of the Google Drive sync, shared by the update-decision route's
 * "create-drive-folder" action branch.
 */
const mockGetExecutiveBrief = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBrief: (...a: unknown[]) => mockGetExecutiveBrief(...a),
}));

const mockGetProjectById = jest.fn();
jest.mock('@/helpers/project', () => ({
  getProjectById: (...a: unknown[]) => mockGetProjectById(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/google-drive-queue', () => ({
  enqueueGoogleDriveSync: (...a: unknown[]) => mockEnqueue(...a),
}));

import { enqueueDriveFolderForBrief } from './brief-drive-folder';

const briefFixture = {
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  sections: { summary: { data: { agency: 'DoD', title: 'Widget RFP' } } },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetExecutiveBrief.mockResolvedValue(briefFixture);
  mockGetProjectById.mockResolvedValue({ id: 'proj-1', name: 'Project One' });
  mockEnqueue.mockResolvedValue(undefined);
});

describe('enqueueDriveFolderForBrief', () => {
  it('enqueues a Drive sync and returns "enqueued" on the happy path', async () => {
    const result = await enqueueDriveFolderForBrief('brief-1', 'org-1');

    expect(result).toEqual({ status: 'enqueued', executiveBriefId: 'brief-1' });
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'proj-1',
        opportunityId: 'opp-1',
        executiveBriefId: 'brief-1',
        agencyName: 'DoD',
        projectTitle: 'Widget RFP',
      }),
    );
  });

  it('is idempotent — returns the existing folder URL without re-enqueuing', async () => {
    mockGetExecutiveBrief.mockResolvedValue({
      ...briefFixture,
      googleDriveFolderUrl: 'https://drive.google.com/drive/folders/abc',
    });

    const result = await enqueueDriveFolderForBrief('brief-1', 'org-1');

    expect(result).toEqual({
      status: 'exists',
      googleDriveFolderUrl: 'https://drive.google.com/drive/folders/abc',
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns "not_found" when the brief does not exist', async () => {
    mockGetExecutiveBrief.mockResolvedValue(null);

    const result = await enqueueDriveFolderForBrief('brief-1', 'org-1');

    expect(result).toEqual({ status: 'not_found' });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('falls back to the project name when the summary has no title', async () => {
    mockGetExecutiveBrief.mockResolvedValue({
      ...briefFixture,
      sections: { summary: { data: { agency: 'DoD' } } },
    });

    await enqueueDriveFolderForBrief('brief-1', 'org-1');

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ projectTitle: 'Project One' }),
    );
  });
});
