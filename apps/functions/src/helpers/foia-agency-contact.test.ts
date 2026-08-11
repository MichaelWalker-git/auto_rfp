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
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { buildAgencyContactSk, getAgencyContact } from './foia-agency-contact';

describe('foia-agency-contact helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('buildAgencyContactSk', () => {
    it('builds SK with orgId and normalized agencyKey', () => {
      const sk = buildAgencyContactSk('org-123', 'DEPT OF THE ARMY');
      expect(sk).toBe('org-123#DEPT OF THE ARMY');
    });
  });

  describe('getAgencyContact', () => {
    it('normalizes agency name before lookup', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      await getAgencyContact('org-1', 'Dept. of the Army');

      const call = mockSend.mock.calls[0][0];
      expect(call.type).toBe('Get');
      // normalizeAgencyKey strips punctuation, uppercases, collapses whitespace
      expect(call.params.Key.sort_key).toBe('org-1#DEPT OF THE ARMY');
    });

    it('performs exact key match', async () => {
      const agencyContact = {
        partition_key: 'ORG_AGENCY_CONTACT',
        sort_key: 'org-1#DEPT OF THE ARMY',
        orgId: 'org-1',
        agencyName: 'Dept. of the Army',
        agencyKey: 'DEPT OF THE ARMY',
        foiaEmail: 'foia@army.mil',
        acceptsEmail: true,
      };

      mockSend.mockResolvedValueOnce({ Item: agencyContact });

      const result = await getAgencyContact('org-1', 'Dept. of the Army');

      expect(result).toEqual(agencyContact);
    });

    it('returns null when agency not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const result = await getAgencyContact('org-1', 'Unknown Agency');

      expect(result).toBeNull();
    });

    it('normalizes different spellings to same key', async () => {
      const testCases = [
        'Dept. of the Army',
        'DEPT OF THE ARMY',
        '  dept of the army ',
        'Dept   of   the   Army',
      ];

      for (const name of testCases) {
        mockSend.mockResolvedValueOnce({ Item: null });
        await getAgencyContact('org-1', name);
      }

      // All should produce the same normalized SK
      const calls = mockSend.mock.calls.map((c) => c[0].params.Key.sort_key);
      expect(new Set(calls).size).toBe(1);
      expect(calls[0]).toBe('org-1#DEPT OF THE ARMY');
    });

    it('does NOT fuzzy match sibling agencies', async () => {
      // "DEPT OF THE AIR FORCE" and "DEPT OF THE ARMY" are different keys
      mockSend.mockResolvedValueOnce({ Item: null });

      await getAgencyContact('org-1', 'Dept of the Air Force');

      const call = mockSend.mock.calls[0][0];
      expect(call.params.Key.sort_key).toBe('org-1#DEPT OF THE AIR FORCE');
      expect(call.params.Key.sort_key).not.toBe('org-1#DEPT OF THE ARMY');
    });
  });
});
