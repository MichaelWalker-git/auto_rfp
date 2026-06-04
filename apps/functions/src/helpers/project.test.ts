// Mock middy before importing
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  ScanCommand: jest.fn((params) => ({ type: 'Scan', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';

import { getProjectById } from './project';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { ORG_PK, PROJECT_PK } from '@/constants/organization';

const ORG_ID = 'org-123';
const PROJECT_ID = 'proj-456';

const projectItem = {
  [PK_NAME]: PROJECT_PK,
  [SK_NAME]: `${ORG_ID}#${PROJECT_ID}`,
  id: PROJECT_ID,
  orgId: ORG_ID,
  name: 'Test Project',
};

const orgItem = {
  [PK_NAME]: ORG_PK,
  [SK_NAME]: ORG_ID,
  id: ORG_ID,
  name: 'Test Org',
};

describe('getProjectById', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('fast path (orgId provided)', () => {
    it('fetches the project with a single GetItem and never scans', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: projectItem }) // GetItem project
        .mockResolvedValueOnce({ Item: orgItem }); // GetItem org

      const result = await getProjectById(PROJECT_ID, ORG_ID);

      // No Scan was issued — every call must be a GetItem
      const sentTypes = mockSend.mock.calls.map(([cmd]) => (cmd as { type: string }).type);
      expect(sentTypes).toEqual(['Get', 'Get']);
      expect(sentTypes).not.toContain('Scan');

      // The project lookup used the exact composite key
      const [projectCmd] = mockSend.mock.calls[0] as [{ params: { Key: Record<string, string> } }];
      expect(projectCmd.params.Key).toEqual({
        [PK_NAME]: PROJECT_PK,
        [SK_NAME]: `${ORG_ID}#${PROJECT_ID}`,
      });

      // Returns the project with the organization attached
      expect(result).toEqual({ ...projectItem, organization: orgItem });
    });

    it('returns null without fetching the org when the project does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // GetItem project -> miss

      const result = await getProjectById(PROJECT_ID, ORG_ID);

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1); // short-circuits, no org lookup
    });
  });

  describe('fallback path (orgId omitted)', () => {
    it('scans for the project when orgId is unknown', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [projectItem], LastEvaluatedKey: undefined }) // Scan
        .mockResolvedValueOnce({ Item: orgItem }); // GetItem org

      const result = await getProjectById(PROJECT_ID);

      const sentTypes = mockSend.mock.calls.map(([cmd]) => (cmd as { type: string }).type);
      expect(sentTypes[0]).toBe('Scan');
      expect(result).toEqual({ ...projectItem, organization: orgItem });
    });

    it('returns null when the scan finds nothing', async () => {
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined }); // Scan -> empty

      const result = await getProjectById(PROJECT_ID);

      expect(result).toBeNull();
    });
  });
});
