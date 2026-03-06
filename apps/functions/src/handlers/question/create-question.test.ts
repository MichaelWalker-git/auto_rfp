// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './create-question';
import { createQuestions } from '@/helpers/question';
import type { CreateQuestions } from '@auto-rfp/core';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

describe('create-question', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  // ─── createQuestions helper ───────────────────────────────────────────────────

  describe('createQuestions', () => {
    it('creates questions for each section and returns created list', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [
          {
            title: 'Technical',
            questions: [{ question: 'What is your approach?' }, { question: 'Describe your team.' }],
          },
        ],
      };

      const result = await createQuestions(dto);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        questionId: 'mock-uuid',
        question: 'What is your approach?',
        sectionTitle: 'Technical',
      });
      expect(result[1]).toEqual({
        questionId: 'mock-uuid',
        question: 'Describe your team.',
        sectionTitle: 'Technical',
      });
    });

    it('uses opportunityId in SK', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: 'What is your price?' }] }],
      };

      await createQuestions(dto);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              sort_key: 'proj-456#opp-789#manual#mock-uuid',
            }),
          }),
        }),
      );
    });

    it('uses questionFileId in SK when provided', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        questionFileId: 'file-abc',
        sections: [{ questions: [{ question: 'What is your price?' }] }],
      };

      await createQuestions(dto);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              sort_key: 'proj-456#opp-789#file-abc#mock-uuid',
              questionFileId: 'file-abc',
            }),
          }),
        }),
      );
    });

    it('defaults questionFileId to "manual" when not provided', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: 'Q?' }] }],
      };

      await createQuestions(dto);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              questionFileId: 'manual',
            }),
          }),
        }),
      );
    });

    it('defaults sectionTitle to "Untitled Section" when not provided', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: 'Any question?' }] }],
      };

      const result = await createQuestions(dto);

      expect(result[0].sectionTitle).toBe('Untitled Section');
    });

    it('skips questions with empty or whitespace-only text', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [
          {
            questions: [
              { question: '  ' },
              { question: 'Valid question?' },
            ],
          },
        ],
      };

      const result = await createQuestions(dto);

      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('Valid question?');
    });

    it('trims whitespace from question text', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: '  What is your approach?  ' }] }],
      };

      const result = await createQuestions(dto);

      expect(result[0].question).toBe('What is your approach?');
    });

    it('handles multiple sections', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [
          { title: 'Section A', questions: [{ question: 'Q1?' }] },
          { title: 'Section B', questions: [{ question: 'Q2?' }, { question: 'Q3?' }] },
        ],
      };

      const result = await createQuestions(dto);

      expect(result).toHaveLength(3);
      expect(result[0].sectionTitle).toBe('Section A');
      expect(result[1].sectionTitle).toBe('Section B');
      expect(result[2].sectionTitle).toBe('Section B');
    });

    it('writes to DynamoDB with correct table name and partition key', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: 'Test question?' }] }],
      };

      await createQuestions(dto);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            Item: expect.objectContaining({
              partition_key: 'QUESTION',
              projectId: 'proj-456',
              opportunityId: 'opp-789',
              questionFileId: 'manual',
              sectionDescription: null,
            }),
          }),
        }),
      );
    });

    it('returns empty array when all questions are blank', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateQuestions = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: '   ' }] }],
      };

      const result = await createQuestions(dto);

      expect(result).toHaveLength(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ─── baseHandler (HTTP layer) ─────────────────────────────────────────────────

  describe('baseHandler', () => {
    const makeEvent = (body: unknown): AuthedEvent =>
      ({
        body: JSON.stringify(body),
        auth: { userId: 'user-001', orgId: 'org-123', claims: {} },
        requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
        headers: {},
        queryStringParameters: {},
      }) as unknown as AuthedEvent;

    it('returns 201 with created questions on valid input', async () => {
      mockSend.mockResolvedValue({});

      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ title: 'Technical', questions: [{ question: 'What is your approach?' }] }],
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 201 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('1 questions created');
      expect(body.projectId).toBe('proj-456');
      expect(body.questions).toHaveLength(1);
    });

    it('returns 400 when body is missing', async () => {
      const event = { ...makeEvent({}), body: undefined } as unknown as AuthedEvent;

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Request body is missing');
    });

    it('returns 400 with issues when orgId is missing', async () => {
      const event = makeEvent({
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: 'Q?' }] }],
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
      expect(body.issues).toBeDefined();
    });

    it('returns 400 when projectId is missing', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        opportunityId: 'opp-789',
        sections: [{ questions: [{ question: 'Q?' }] }],
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
    });

    it('returns 400 when opportunityId is missing', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        sections: [{ questions: [{ question: 'Q?' }] }],
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
    });

    it('returns 400 when sections array is empty', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: [],
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
    });

    it('returns 400 when sections is not an array', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        sections: 'not-an-array',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });

    it('passes questionFileId through to createQuestions', async () => {
      mockSend.mockResolvedValue({});

      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        questionFileId: 'file-abc',
        sections: [{ questions: [{ question: 'Q?' }] }],
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 201 });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              sort_key: 'proj-456#opp-789#file-abc#mock-uuid',
              questionFileId: 'file-abc',
            }),
          }),
        }),
      );
    });
  });
});
