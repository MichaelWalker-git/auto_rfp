// Mock AWS SDK before importing the helper (ESM compatibility)
// eslint-disable-next-line no-var
var mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

// S3 is unused by the functions under test but imported by the module
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
  uploadToS3: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

import {
  findBestTemplate,
  clearDefaultForCategory,
  setDefaultTemplate,
} from './template';
import type { TemplateItem } from '@auto-rfp/core';

const baseTemplate = (overrides: Partial<TemplateItem>): TemplateItem => ({
  id: 'tpl-0',
  orgId: 'org-1',
  name: 'Template',
  category: 'TECHNICAL_PROPOSAL',
  tags: [],
  isDefault: false,
  status: 'PUBLISHED',
  currentVersion: 1,
  versions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: '00000000-0000-0000-0000-000000000000',
  isArchived: false,
  usageCount: 0,
  usedInProjectIds: [],
  ...overrides,
});

/** Make mockSend respond to a QueryCommand with the given items, and resolve all other commands. */
const mockQueryItems = (items: TemplateItem[]) => {
  mockSend.mockImplementation((cmd: { type: string }) => {
    if (cmd.type === 'Query') return Promise.resolve({ Items: items });
    return Promise.resolve({});
  });
};

describe('template helper — default template selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('findBestTemplate', () => {
    it('returns null when there are no templates', async () => {
      mockQueryItems([]);
      const result = await findBestTemplate('org-1', 'TECHNICAL_PROPOSAL');
      expect(result).toBeNull();
    });

    it('prefers the default template even over a more recent published one', async () => {
      mockQueryItems([
        baseTemplate({ id: 'newer', status: 'PUBLISHED', updatedAt: '2026-03-01T00:00:00.000Z' }),
        baseTemplate({ id: 'default', status: 'PUBLISHED', isDefault: true, updatedAt: '2026-01-01T00:00:00.000Z' }),
      ]);
      const result = await findBestTemplate('org-1', 'TECHNICAL_PROPOSAL');
      expect(result?.id).toBe('default');
    });

    it('falls back to the latest published template when no default is set', async () => {
      mockQueryItems([
        baseTemplate({ id: 'older', status: 'PUBLISHED', updatedAt: '2026-01-01T00:00:00.000Z' }),
        baseTemplate({ id: 'newer', status: 'PUBLISHED', updatedAt: '2026-05-01T00:00:00.000Z' }),
        baseTemplate({ id: 'draft', status: 'DRAFT', updatedAt: '2026-06-01T00:00:00.000Z' }),
      ]);
      const result = await findBestTemplate('org-1', 'TECHNICAL_PROPOSAL');
      expect(result?.id).toBe('newer');
    });
  });

  describe('clearDefaultForCategory', () => {
    it('clears the marker on every default template except the excepted one', async () => {
      mockQueryItems([
        baseTemplate({ id: 'a', isDefault: true }),
        baseTemplate({ id: 'b', isDefault: true }),
        baseTemplate({ id: 'keep', isDefault: true }),
        baseTemplate({ id: 'c', isDefault: false }),
      ]);

      const cleared = await clearDefaultForCategory('org-1', 'TECHNICAL_PROPOSAL', 'keep');

      expect(cleared.sort()).toEqual(['a', 'b']);
      const updateCalls = mockSend.mock.calls.filter(([cmd]) => cmd.type === 'Update');
      expect(updateCalls).toHaveLength(2);
      for (const [cmd] of updateCalls) {
        expect(Object.values(cmd.params.ExpressionAttributeValues)).toContain(false);
      }
    });
  });

  describe('setDefaultTemplate', () => {
    it('clears existing defaults in the category then marks the target template', async () => {
      mockQueryItems([
        baseTemplate({ id: 'previous-default', isDefault: true }),
        baseTemplate({ id: 'target', isDefault: false }),
      ]);

      await setDefaultTemplate('org-1', 'target', 'TECHNICAL_PROPOSAL');

      const updateCalls = mockSend.mock.calls.filter(([cmd]) => cmd.type === 'Update');
      // one clear for previous-default, one set for target
      expect(updateCalls).toHaveLength(2);

      const targetSk = 'org-1#target';
      const setCall = updateCalls.find(([cmd]) => cmd.params.Key.sort_key === targetSk);
      expect(setCall).toBeDefined();
      expect(Object.values(setCall![0].params.ExpressionAttributeValues)).toContain(true);
    });
  });
});
