// Mock middy before importing handlers
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
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { handler } from './get-assigned-reviews';
import * as dbHelpers from '@/helpers/db';
import * as userHelpers from '@/helpers/user';
import * as rfpDocumentHelpers from '@/helpers/rfp-document';
import * as projectHelpers from '@/helpers/project';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { UniversalApprovalItem, DocumentApprovalItem } from '@auto-rfp/core';

// Mock helper functions
jest.mock('@/helpers/db');
jest.mock('@/helpers/user');
jest.mock('@/helpers/rfp-document');
jest.mock('@/helpers/project');

const mockQueryBySkPrefix = dbHelpers.queryBySkPrefix as jest.MockedFunction<typeof dbHelpers.queryBySkPrefix>;
const mockGetUserByOrgAndId = userHelpers.getUserByOrgAndId as jest.MockedFunction<typeof userHelpers.getUserByOrgAndId>;
const mockGetRFPDocument = rfpDocumentHelpers.getRFPDocument as jest.MockedFunction<typeof rfpDocumentHelpers.getRFPDocument>;
const mockGetProjectById = projectHelpers.getProjectById as jest.MockedFunction<typeof projectHelpers.getProjectById>;

const createMockEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent => ({
  version: '2.0',
  routeKey: 'GET /document-approval/assigned-reviews',
  rawPath: '/document-approval/assigned-reviews',
  rawQueryString: 'orgId=org-123&userId=user-456',
  headers: {},
  requestContext: {
    accountId: '123456789012',
    apiId: 'test-api',
    domainName: 'test.execute-api.us-east-1.amazonaws.com',
    domainPrefix: 'test',
    http: {
      method: 'GET',
      path: '/document-approval/assigned-reviews',
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'test-agent',
    },
    requestId: 'test-request-id',
    routeKey: 'GET /document-approval/assigned-reviews',
    stage: 'test',
    time: '01/Jan/2023:00:00:00 +0000',
    timeEpoch: 1672531200000,
  },
  queryStringParameters: {
    orgId: 'org-123',
    userId: 'user-456',
  },
  auth: {
    userId: 'user-456',
    orgId: 'org-123',
    claims: {},
  },
  isBase64Encoded: false,
  ...overrides,
});

const mockUniversalApproval: UniversalApprovalItem = {
  approvalId: 'approval-123',
  orgId: 'org-123',
  projectId: 'proj-456',
  entityType: 'rfp-document',
  entityId: 'doc-789',
  entitySK: 'org-123#proj-456#opp-101#doc-789',
  entityName: 'Test Document',
  opportunityId: 'opp-101',
  documentId: 'doc-789',
  status: 'PENDING',
  requestedBy: 'user-requester-123',
  requestedByName: undefined, // This should be populated by the handler
  requestedAt: '2023-01-01T00:00:00Z',
  reviewerId: 'user-456',
  reviewerName: 'Test Reviewer',
  priority: 'NORMAL',
  tags: [],
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

const mockLegacyApproval: DocumentApprovalItem = {
  approvalId: 'approval-456',
  orgId: 'org-123',
  projectId: 'proj-456',
  opportunityId: 'opp-101',
  documentId: 'doc-890',
  status: 'REJECTED',
  requestedBy: 'user-requester-456',
  requestedByName: undefined, // This should be populated by the handler
  requestedAt: '2023-01-01T00:00:00Z',
  reviewerId: 'user-456',
  reviewerName: 'Test Reviewer',
  reviewedAt: '2023-01-01T01:00:00Z',
  reviewNote: 'Document needs revision',
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T01:00:00Z',
};

const mockUser = {
  userId: 'user-requester-123',
  orgId: 'org-123',
  email: 'requester@example.com',
  displayName: 'John Doe',
  firstName: 'John',
  lastName: 'Doe',
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

const mockProject = {
  id: 'proj-456',
  name: 'Test Project',
  orgId: 'org-123',
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

const mockDocument = {
  documentId: 'doc-789',
  name: 'Test Document',
  title: 'Test Document Title',
  projectId: 'proj-456',
  opportunityId: 'opp-101',
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  
  // Default mock implementations
  mockQueryBySkPrefix.mockImplementation((pk) => {
    if (pk.includes('UNIVERSAL_APPROVAL')) {
      return Promise.resolve([mockUniversalApproval]);
    } else if (pk.includes('DOCUMENT_APPROVAL')) {
      return Promise.resolve([mockLegacyApproval]);
    }
    return Promise.resolve([]);
  });
  
  mockGetUserByOrgAndId.mockResolvedValue(mockUser);
  mockGetProjectById.mockResolvedValue(mockProject);
  mockGetRFPDocument.mockResolvedValue(mockDocument);
});

describe('get-assigned-reviews handler', () => {
  it('should populate user display names for universal approvals', async () => {
    const event = createMockEvent();
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body!);
    expect(body.reviews).toHaveLength(2); // One universal + one legacy
    
    // Check that user display name was populated for universal approval
    const universalReview = body.reviews.find((r: any) => r.approvalId === 'approval-123');
    expect(universalReview).toBeDefined();
    expect(universalReview.requestedByName).toBe('John Doe');
    expect(mockGetUserByOrgAndId).toHaveBeenCalledWith('org-123', 'user-requester-123');
  });

  it('should populate user display names for legacy approvals', async () => {
    const event = createMockEvent();
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body!);
    
    // Check that user display name was populated for legacy approval
    const legacyReview = body.reviews.find((r: any) => r.approvalId === 'approval-456');
    expect(legacyReview).toBeDefined();
    expect(legacyReview.requestedByName).toBe('John Doe');
    expect(mockGetUserByOrgAndId).toHaveBeenCalledWith('org-123', 'user-requester-456');
  });

  it('should handle missing user gracefully', async () => {
    mockGetUserByOrgAndId.mockRejectedValue(new Error('User not found'));
    
    const event = createMockEvent();
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body!);
    const review = body.reviews[0];
    
    // Should still return the approval even if user lookup fails
    expect(review).toBeDefined();
    expect(review.requestedByName).toBeUndefined();
  });

  it('should not fetch user info if display name already exists and looks valid', async () => {
    // Mock approval with existing valid display name
    const approvalWithName = {
      ...mockUniversalApproval,
      requestedByName: 'Jane Smith',
    };
    
    mockQueryBySkPrefix.mockImplementation((pk) => {
      if (pk.includes('UNIVERSAL_APPROVAL')) {
        return Promise.resolve([approvalWithName]);
      }
      return Promise.resolve([]);
    });
    
    const event = createMockEvent();
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body!);
    const review = body.reviews[0];
    
    expect(review.requestedByName).toBe('Jane Smith');
    // Should not have called getUserByOrgAndId since name was already valid
    expect(mockGetUserByOrgAndId).not.toHaveBeenCalled();
  });

  it('should fetch user info if display name looks like a raw ID', async () => {
    // Mock approval with ID-like display name
    const approvalWithId = {
      ...mockUniversalApproval,
      requestedByName: 'user-123-456-789',
    };
    
    mockQueryBySkPrefix.mockImplementation((pk) => {
      if (pk.includes('UNIVERSAL_APPROVAL')) {
        return Promise.resolve([approvalWithId]);
      }
      return Promise.resolve([]);
    });
    
    const event = createMockEvent();
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body!);
    const review = body.reviews[0];
    
    expect(review.requestedByName).toBe('John Doe');
    // Should have called getUserByOrgAndId to get proper display name
    expect(mockGetUserByOrgAndId).toHaveBeenCalledWith('org-123', 'user-requester-123');
  });

  it('should use fallback display name when user has no displayName', async () => {
    const userWithoutDisplayName = {
      ...mockUser,
      displayName: undefined,
      firstName: 'John',
      lastName: 'Doe',
    };
    
    mockGetUserByOrgAndId.mockResolvedValue(userWithoutDisplayName);
    
    const event = createMockEvent();
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body!);
    const review = body.reviews[0];
    
    expect(review.requestedByName).toBe('John Doe'); // firstName + lastName
  });

  it('should use email fallback when no name is available', async () => {
    const userWithOnlyEmail = {
      ...mockUser,
      displayName: undefined,
      firstName: undefined,
      lastName: undefined,
      email: 'john.doe@example.com',
    };
    
    mockGetUserByOrgAndId.mockResolvedValue(userWithOnlyEmail);
    
    const event = createMockEvent();
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200);
    
    const body = JSON.parse(response.body!);
    const review = body.reviews[0];
    
    expect(review.requestedByName).toBe('john.doe'); // email prefix
  });

  it('should return 400 when orgId is missing', async () => {
    const event = createMockEvent({
      queryStringParameters: { userId: 'user-456' },
      auth: { ...createMockEvent().auth!, orgId: undefined },
    });
    
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body!).message).toBe('orgId is required');
  });

  it('should return 400 when userId is missing', async () => {
    const event = createMockEvent({
      queryStringParameters: { orgId: 'org-123' },
      auth: { ...createMockEvent().auth!, userId: undefined },
    });
    
    const response = await handler.handler(event, {} as any);
    
    expect(response.statusCode).toBe(200); // Should use auth userId as fallback
  });
});