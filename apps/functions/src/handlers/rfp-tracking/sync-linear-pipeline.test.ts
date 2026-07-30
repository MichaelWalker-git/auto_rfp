// Mock middy + Sentry wrapper so importing the handler module is side-effect free.
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));

// The Linear SDK is only exercised by the full sync path, not by ensureSyncProject.
jest.mock('@linear/sdk', () => ({ LinearClient: jest.fn(() => ({})) }));

// DB helpers — the unit under test only touches getItem/putItem.
const mockGetItem = jest.fn();
const mockPutItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: jest.fn() },
  queryAllBySkPrefix: jest.fn(),
  deleteItem: jest.fn(),
  getItem: (...args: unknown[]) => mockGetItem(...args),
  putItem: (...args: unknown[]) => mockPutItem(...args),
}));

// Secrets lookup — unused by ensureSyncProject, stubbed for a clean import.
jest.mock('@/helpers/api-key-storage', () => ({ getApiKey: jest.fn() }));

// Required env is read at module load — set before importing the handler.
process.env.DB_TABLE_NAME = 'test-table';
process.env.RFP_SYNC_ORG_ID = 'org-123';
process.env.RFP_SYNC_PROJECT_ID = 'gov-contracting';
process.env.RFP_SYNC_LINEAR_ORG_ID = 'linear-org-1';
process.env.RFP_SYNC_PROJECT_NAME = 'Government Contracting';

import { PROJECT_PK } from '@/constants/organization';
import { ensureSyncProject } from './sync-linear-pipeline';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureSyncProject', () => {
  it('seeds the synthetic gov-contracting project when it does not exist', async () => {
    mockGetItem.mockResolvedValue(null);

    await ensureSyncProject();

    expect(mockGetItem).toHaveBeenCalledWith(PROJECT_PK, 'org-123#gov-contracting');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledWith(
      PROJECT_PK,
      'org-123#gov-contracting',
      expect.objectContaining({
        id: 'gov-contracting',
        orgId: 'org-123',
        name: 'Government Contracting',
      }),
    );
  });

  it('omits createdBy so get-projects treats it as visible to every org member', async () => {
    mockGetItem.mockResolvedValue(null);

    await ensureSyncProject();

    const [, , item] = mockPutItem.mock.calls[0];
    expect(item).not.toHaveProperty('createdBy');
  });

  it('is idempotent — does not rewrite the project when it already exists', async () => {
    mockGetItem.mockResolvedValue({ id: 'gov-contracting', orgId: 'org-123' });

    await ensureSyncProject();

    expect(mockPutItem).not.toHaveBeenCalled();
  });
});
