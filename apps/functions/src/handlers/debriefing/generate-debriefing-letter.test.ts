// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { generateDebriefingLetter, validateLetterFields, baseHandler } from './generate-debriefing-letter';
import type { DBDebriefingItem } from '@/types/project-outcome';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const mockDebriefing: DBDebriefingItem = {
  partition_key: 'DEBRIEFING',
  sort_key: 'org-456#proj-123#debrief-1',
  debriefId: 'debrief-1',
  projectId: 'proj-123',
  orgId: 'org-456',
  requestStatus: 'REQUESTED',
  requestDeadline: '2025-01-20T00:00:00.000Z',
  solicitationNumber: 'W911NF-21-R-0001',
  contractNumber: 'W911NF-21-C-0001',
  contractTitle: 'IT Services Contract',
  awardedOrganization: 'WinnerCo LLC',
  awardNotificationDate: 'January 15, 2025',
  contractingOfficerName: 'Jane Officer',
  contractingOfficerEmail: 'jane@agency.gov',
  contractingOfficerAddress: '1400 Defense Pentagon, Washington DC 20301',
  requesterName: 'John Smith',
  requesterTitle: 'Contracts Manager',
  requesterEmail: 'john@company.com',
  requesterAddress: '123 Business Ave, Arlington VA 22201',
  companyName: 'Acme Corp',
  createdAt: '2025-01-15T00:00:00Z',
  updatedAt: '2025-01-15T00:00:00Z',
  createdBy: 'user-789',
};

describe('generate-debriefing-letter handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('validateLetterFields', () => {
    it('returns empty array when all required fields are present', () => {
      const missing = validateLetterFields(mockDebriefing);

      expect(missing).toEqual([]);
    });

    it('returns missing field names when fields are absent', () => {
      const incomplete: DBDebriefingItem = {
        ...mockDebriefing,
        contractingOfficerName: undefined,
        requesterName: undefined,
        companyName: undefined,
      };

      const missing = validateLetterFields(incomplete);

      expect(missing).toContain('contractingOfficerName');
      expect(missing).toContain('requesterName');
      expect(missing).toContain('companyName');
      expect(missing).toHaveLength(3);
    });

    it('detects empty strings as missing', () => {
      const emptyFields: DBDebriefingItem = {
        ...mockDebriefing,
        requesterEmail: '' as unknown as string,
      };

      const missing = validateLetterFields(emptyFields);

      expect(missing).toContain('requesterEmail');
    });
  });

  describe('generateDebriefingLetter', () => {
    it('includes the date in the letter', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toMatch(/\w+ \d{1,2}, \d{4}/);
    });

    it('includes contracting officer information', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('Jane Officer');
      expect(letter).toContain('1400 Defense Pentagon, Washington DC 20301');
      expect(letter).toContain('jane@agency.gov');
    });

    it('includes solicitation and contract numbers', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('Solicitation No. W911NF-21-R-0001');
      expect(letter).toContain('Contract No. W911NF-21-C-0001');
    });

    it('includes contract title in subject line', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('IT Services Contract');
    });

    it('references FAR 15.506', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('FAR 15.506');
    });

    it('includes company name in the letter body', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('on behalf of Acme Corp');
    });

    it('includes awarded organization', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('awarded to WinnerCo LLC');
    });

    it('includes award notification date', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('notification of the award on January 15, 2025');
    });

    it('lists the five standard FAR debriefing topics', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('significant weaknesses or deficiencies');
      expect(letter).toContain('overall evaluated cost or price');
      expect(letter).toContain('overall ranking of all offerors');
      expect(letter).toContain('rationale for award');
      expect(letter).toContain('source selection procedures');
    });

    it('includes requester contact information in closing', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('John Smith');
      expect(letter).toContain('Contracts Manager');
      expect(letter).toContain('Acme Corp');
      expect(letter).toContain('john@company.com');
      expect(letter).toContain('123 Business Ave, Arlington VA 22201');
    });

    it('ends with Sincerely closing', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).toContain('Sincerely,');
    });

    it('does not contain any placeholder brackets', () => {
      const letter = generateDebriefingLetter(mockDebriefing);

      expect(letter).not.toMatch(/\[.*\]/);
    });
  });

  describe('baseHandler', () => {
    const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
      ({
        body: JSON.stringify(body),
      }) as unknown as APIGatewayProxyEventV2;

    it('returns 400 for invalid payload', async () => {
      const result = await baseHandler(makeEvent({}));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Invalid payload');
    });

    it('returns 404 when debriefing is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        debriefingId: 'nonexistent',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(404);
      expect(parsed.message).toBe('Debriefing request not found');
    });

    it('returns 400 when debriefing is missing required letter fields', async () => {
      const incompleteDebriefing: DBDebriefingItem = {
        partition_key: 'DEBRIEFING',
        sort_key: 'org-456#proj-123#debrief-2',
        debriefId: 'debrief-2',
        projectId: 'proj-123',
        orgId: 'org-456',
        requestStatus: 'REQUESTED',
        requestDeadline: '2025-01-20T00:00:00.000Z',
        solicitationNumber: 'GS-00F-0001',
        contractNumber: 'GS-00F-C-0001',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        createdBy: 'user-789',
      };

      mockSend.mockResolvedValueOnce({ Item: incompleteDebriefing });

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        debriefingId: 'debrief-2',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('missing required fields');
      expect(parsed.missingFields).toContain('contractTitle');
      expect(parsed.missingFields).toContain('contractingOfficerName');
      expect(parsed.missingFields).toContain('requesterName');
      expect(parsed.missingFields).toContain('companyName');
    });

    it('returns 200 with generated letter when debriefing has all required fields', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockDebriefing });

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        debriefingId: 'debrief-1',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(parsed.letter).toContain('FAR 15.506');
      expect(parsed.letter).toContain('Acme Corp');
    });

    it('uses correct DynamoDB key for the GetCommand', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockDebriefing });

      await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        debriefingId: 'debrief-1',
      }));

      const getCall = mockSend.mock.calls[0][0];
      expect(getCall.type).toBe('Get');
      expect(getCall.params.TableName).toBe('test-table');
      expect(getCall.params.Key.partition_key).toBe('DEBRIEFING');
      expect(getCall.params.Key.sort_key).toBe('org-456#proj-123#debrief-1');
    });
  });
});
