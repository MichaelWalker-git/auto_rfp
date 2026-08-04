const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  ScanCommand: jest.fn((params) => ({ type: 'Scan', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  buildDocumentPromptSk,
  saveDocumentPrompt,
  readDocumentPrompt,
  deleteDocumentPrompt,
  saveSystemPrompt,
  readSystemPrompt,
} from './prompt';
import { PK_NAME, SK_NAME } from '../constants/common';
import { SYSTEM_PROMPT_PK, USER_PROMPT_PK } from '../constants/prompt';

const ORG_ID = 'org-123';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('buildDocumentPromptSk', () => {
  it('builds a 3-segment SK namespaced under RFP_DOCUMENT', () => {
    expect(buildDocumentPromptSk(ORG_ID, 'COST_PROPOSAL')).toBe('org-123#RFP_DOCUMENT#COST_PROPOSAL');
  });

  it('does not collide with the 2-segment legacy feature-prompt SK', () => {
    const legacyFeatureSk = `${ORG_ID}#RFP_DOCUMENT`;
    const documentSk = buildDocumentPromptSk(ORG_ID, 'TECHNICAL_PROPOSAL');
    expect(documentSk).not.toBe(legacyFeatureSk);
    expect(documentSk.startsWith(`${legacyFeatureSk}#`)).toBe(true);
    expect(documentSk.split('#')).toHaveLength(3);
  });
});

describe('saveDocumentPrompt', () => {
  it('upserts under the SYSTEM prompt PK with the document SK and returns attributes', async () => {
    const attrs = { prompt: 'Custom guidance', documentType: 'COST_PROPOSAL', scope: 'SYSTEM' };
    mockSend.mockResolvedValueOnce({ Attributes: attrs });

    const result = await saveDocumentPrompt(ORG_ID, 'SYSTEM', 'COST_PROPOSAL', 'Custom guidance');

    expect(result).toEqual(attrs);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { params } = mockSend.mock.calls[0][0];
    expect(params.TableName).toBe('test-table');
    expect(params.Key).toEqual({
      [PK_NAME]: SYSTEM_PROMPT_PK,
      [SK_NAME]: 'org-123#RFP_DOCUMENT#COST_PROPOSAL',
    });
    expect(params.ReturnValues).toBe('ALL_NEW');
  });

  it('uses the USER prompt PK for USER scope', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: {} });

    await saveDocumentPrompt(ORG_ID, 'USER', 'PRICE_VOLUME', 'Custom task');

    const { params } = mockSend.mock.calls[0][0];
    expect(params.Key).toEqual({
      [PK_NAME]: USER_PROMPT_PK,
      [SK_NAME]: 'org-123#RFP_DOCUMENT#PRICE_VOLUME',
    });
  });

  it('sets documentType and scope attributes so rows are distinguishable when queried', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: {} });

    await saveDocumentPrompt(ORG_ID, 'SYSTEM', 'COVER_LETTER', 'text');

    const { params } = mockSend.mock.calls[0][0];
    expect(params.UpdateExpression).toContain('#documentType');
    expect(params.UpdateExpression).toContain('#scope');
    expect(params.ExpressionAttributeValues[':documentType']).toBe('COVER_LETTER');
    expect(params.ExpressionAttributeValues[':scope']).toBe('SYSTEM');
    expect(params.ExpressionAttributeValues[':p']).toBe('text');
    expect(params.ExpressionAttributeValues[':orgId']).toBe(ORG_ID);
    expect(params.ExpressionAttributeValues[':u']).toEqual(expect.any(String));
  });
});

describe('readDocumentPrompt', () => {
  it('reads by scope PK + document SK and returns the item', async () => {
    const item = { prompt: 'Custom guidance', documentType: 'RISK_MANAGEMENT', scope: 'SYSTEM' };
    mockSend.mockResolvedValueOnce({ Item: item });

    const result = await readDocumentPrompt(ORG_ID, 'SYSTEM', 'RISK_MANAGEMENT');

    expect(result).toEqual(item);
    const { type, params } = mockSend.mock.calls[0][0];
    expect(type).toBe('Get');
    expect(params.Key).toEqual({
      [PK_NAME]: SYSTEM_PROMPT_PK,
      [SK_NAME]: 'org-123#RFP_DOCUMENT#RISK_MANAGEMENT',
    });
  });

  it('returns null when the item is not found', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await readDocumentPrompt(ORG_ID, 'USER', 'APPENDICES');

    expect(result).toBeNull();
    const { params } = mockSend.mock.calls[0][0];
    expect(params.Key[PK_NAME]).toBe(USER_PROMPT_PK);
  });
});

describe('deleteDocumentPrompt', () => {
  it('deletes by scope PK + document SK', async () => {
    mockSend.mockResolvedValueOnce({});

    await deleteDocumentPrompt(ORG_ID, 'USER', 'EXECUTIVE_SUMMARY');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const { type, params } = mockSend.mock.calls[0][0];
    expect(type).toBe('Delete');
    expect(params.TableName).toBe('test-table');
    expect(params.Key).toEqual({
      [PK_NAME]: USER_PROMPT_PK,
      [SK_NAME]: 'org-123#RFP_DOCUMENT#EXECUTIVE_SUMMARY',
    });
  });
});

describe('save/read/delete round-trip', () => {
  it('uses the same key for save, read, and delete of the same org/scope/type', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: { prompt: 'v1' } })
      .mockResolvedValueOnce({ Item: { prompt: 'v1' } })
      .mockResolvedValueOnce({});

    await saveDocumentPrompt(ORG_ID, 'SYSTEM', 'QUALITY_MANAGEMENT', 'v1');
    await readDocumentPrompt(ORG_ID, 'SYSTEM', 'QUALITY_MANAGEMENT');
    await deleteDocumentPrompt(ORG_ID, 'SYSTEM', 'QUALITY_MANAGEMENT');

    const keys = mockSend.mock.calls.map((call) => call[0].params.Key);
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[1]).toEqual(keys[2]);
  });
});

describe('legacy feature prompt helpers (regression)', () => {
  it('saveSystemPrompt still writes to the 2-segment feature SK', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: {} });

    await saveSystemPrompt(ORG_ID, 'RFP_DOCUMENT', 'legacy prompt');

    const { params } = mockSend.mock.calls[0][0];
    expect(params.Key).toEqual({
      [PK_NAME]: SYSTEM_PROMPT_PK,
      [SK_NAME]: 'org-123#RFP_DOCUMENT',
    });
  });

  it('readSystemPrompt still reads the 2-segment feature SK', async () => {
    mockSend.mockResolvedValueOnce({ Item: { prompt: 'legacy' } });

    const result = await readSystemPrompt(ORG_ID, 'RFP_DOCUMENT');

    expect(result).toEqual({ prompt: 'legacy' });
    const { params } = mockSend.mock.calls[0][0];
    expect(params.Key[SK_NAME]).toBe('org-123#RFP_DOCUMENT');
  });
});
