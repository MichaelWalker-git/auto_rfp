jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
}));

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({})),
  GetParameterCommand: jest.fn((params) => ({ type: 'GetParameter', params })),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({})),
  GetSecretValueCommand: jest.fn((params) => ({ type: 'GetSecretValue', params })),
}));

jest.mock('@/helpers/org-contact', () => ({
  getOrgPrimaryContact: jest.fn(),
}));

jest.mock('@/helpers/project', () => ({
  getProjectById: jest.fn(),
}));

jest.mock('@/helpers/user', () => ({
  getOrgMembers: jest.fn(),
}));

jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBriefByProjectId: jest.fn(),
  truncateText: jest.fn((text: string, max: number) => text.slice(0, max)),
}));

jest.mock('@/helpers/embeddings', () => ({
  getEmbedding: jest.fn(),
}));

jest.mock('@/helpers/semantic-search', () => ({
  semanticSearchContentLibrary: jest.fn(),
}));

jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('test-secret'),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.STAGE = 'test';
process.env.DEADLINE_PK = 'DEADLINE';

import {
  fetchOrganizationDetails,
  fetchOrgPrimaryContact,
  fetchProjectDetails,
  fetchTeamMembers,
  fetchDeadlineInfo,
  logToolUsage,
} from './db-tool-helpers';
import { getOrgPrimaryContact } from '@/helpers/org-contact';
import { getProjectById } from '@/helpers/project';
import { getOrgMembers } from '@/helpers/user';
import { writeAuditLog } from '@/helpers/audit-log';

const ORG_ID = 'org-123';
const PROJECT_ID = 'proj-456';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('fetchOrganizationDetails', () => {
  it('returns formatted org string when found', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { name: 'Acme Corp', description: 'Federal contractor', cage: '7XYZ1' },
    });
    const result = await fetchOrganizationDetails(ORG_ID);
    expect(result).toContain('Company Name: Acme Corp');
    expect(result).toContain('CAGE Code: 7XYZ1');
    expect(result).toContain('=== ORGANIZATION ===');
  });

  it('returns empty string when org not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const result = await fetchOrganizationDetails(ORG_ID);
    expect(result).toBe('');
  });

  it('returns empty string on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));
    const result = await fetchOrganizationDetails(ORG_ID);
    expect(result).toBe('');
  });
});

describe('fetchOrgPrimaryContact', () => {
  it('returns formatted contact string when found', async () => {
    (getOrgPrimaryContact as jest.Mock).mockResolvedValueOnce({
      name: 'Jane Smith',
      title: 'VP Contracts',
      email: 'jane@example.com',
      phone: '555-0100',
    });
    const result = await fetchOrgPrimaryContact(ORG_ID);
    expect(result).toContain('=== PRIMARY CONTACT (PROPOSAL SIGNATORY) ===');
    expect(result).toContain('Name: Jane Smith');
    expect(result).toContain('Title: VP Contracts');
    expect(result).toContain('Email: jane@example.com');
    expect(result).toContain('Phone: 555-0100');
  });

  it('returns empty string when no contact configured', async () => {
    (getOrgPrimaryContact as jest.Mock).mockResolvedValueOnce(null);
    const result = await fetchOrgPrimaryContact(ORG_ID);
    expect(result).toBe('');
  });
});

describe('fetchProjectDetails', () => {
  it('returns formatted project string when found', async () => {
    (getProjectById as jest.Mock).mockResolvedValueOnce({
      name: 'DISA Cloud Migration',
      description: 'Cloud migration project',
      organization: { name: 'Acme Corp' },
    });
    const result = await fetchProjectDetails(PROJECT_ID);
    expect(result).toContain('=== PROJECT ===');
    expect(result).toContain('Project Name: DISA Cloud Migration');
    expect(result).toContain('Organization: Acme Corp');
  });

  it('returns empty string when project not found', async () => {
    (getProjectById as jest.Mock).mockResolvedValueOnce(null);
    const result = await fetchProjectDetails(PROJECT_ID);
    expect(result).toBe('');
  });
});

describe('fetchTeamMembers', () => {
  it('returns formatted team list when members found', async () => {
    (getOrgMembers as jest.Mock).mockResolvedValueOnce([
      { displayName: 'John Doe', email: 'john@example.com', title: 'PM', role: 'ADMIN' },
      { email: 'jane@example.com' },
    ]);
    const result = await fetchTeamMembers(ORG_ID);
    expect(result).toContain('=== TEAM MEMBERS ===');
    expect(result).toContain('John Doe');
    expect(result).toContain('PM');
  });

  it('returns empty string when no members', async () => {
    (getOrgMembers as jest.Mock).mockResolvedValueOnce([]);
    const result = await fetchTeamMembers(ORG_ID);
    expect(result).toBe('');
  });
});

describe('fetchDeadlineInfo', () => {
  it('returns formatted deadlines from DynamoDB records', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{
        submissionDeadlineIso: '2025-06-01T17:00:00Z',
        deadlines: [{ type: 'QA_PERIOD', dateTimeIso: '2025-05-15T17:00:00Z' }],
      }],
    });
    const result = await fetchDeadlineInfo(PROJECT_ID, 'opp-789');
    expect(result).toContain('=== DEADLINES ===');
    expect(result).toContain('2025-06-01T17:00:00Z');
  });

  it('returns empty string when no deadlines found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Also mock the brief fallback
    const { getExecutiveBriefByProjectId } = require('@/helpers/executive-opportunity-brief');
    getExecutiveBriefByProjectId.mockRejectedValueOnce(new Error('Not found'));
    const result = await fetchDeadlineInfo(PROJECT_ID, 'opp-789');
    expect(result).toBe('');
  });
});

describe('logToolUsage', () => {
  it('writes audit log with correct action on success', async () => {
    await logToolUsage({
      orgId: ORG_ID,
      resourceId: 'doc-123',
      toolName: 'search_past_performance',
      toolInput: { keywords: 'cloud migration' },
      resultLength: 500,
      resultEmpty: false,
      durationMs: 120,
      result: 'success',
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_TOOL_CALLED',
        resource: 'ai_tool',
        resourceId: 'doc-123',
        result: 'success',
      }),
      'test-secret',
    );
  });

  it('writes AI_TOOL_FAILED on failure', async () => {
    await logToolUsage({
      orgId: ORG_ID,
      resourceId: 'doc-123',
      toolName: 'search_knowledge_base',
      toolInput: { query: 'certifications' },
      resultLength: 0,
      resultEmpty: true,
      durationMs: 50,
      result: 'failure',
      errorMessage: 'Pinecone timeout',
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_TOOL_FAILED',
        result: 'failure',
        errorMessage: 'Pinecone timeout',
      }),
      'test-secret',
    );
  });

  it('does not throw if audit log write fails', async () => {
    (writeAuditLog as jest.Mock).mockRejectedValueOnce(new Error('SSM error'));
    await expect(
      logToolUsage({
        orgId: ORG_ID,
        resourceId: 'doc-123',
        toolName: 'get_deadlines',
        toolInput: {},
        resultLength: 0,
        resultEmpty: true,
        durationMs: 10,
        result: 'success',
      }),
    ).resolves.not.toThrow();
  });
});
