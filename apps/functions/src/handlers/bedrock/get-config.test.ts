jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({})),
  orgMembershipMiddleware: jest.fn(() => ({})),
  requirePermission: jest.fn(() => ({})),
  httpErrorMiddleware: jest.fn(() => ({})),
}));

const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

const mockGetBedrockConfig = jest.fn();
jest.mock('@/helpers/bedrock-config', () => ({
  getBedrockConfig: (...args: unknown[]) => mockGetBedrockConfig(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { getBedrockConfigStatus } from './get-config';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (orgId?: string): AuthedEvent =>
  ({ queryStringParameters: orgId ? { orgId } : {} } as unknown as AuthedEvent);

const parse = (res: unknown) => {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
};

const PROBE = {
  probedAt: '2026-09-01T00:00:00.000Z',
  accepted: true,
  results: [{ modelId: 'amazon.titan-embed-text-v2:0', role: 'embeddings', ok: true }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetApiKey.mockReset();
  mockGetBedrockConfig.mockReset();
});

describe('getBedrockConfigStatus', () => {
  it('reports configured=true with fallback + probe when a key and config exist', async () => {
    mockGetApiKey.mockResolvedValue('the-secret-key');
    mockGetBedrockConfig.mockResolvedValue({ orgId: 'org-1', fallbackModelId: 'fb-model', lastProbe: PROBE });

    const res = parse(await getBedrockConfigStatus(makeEvent('org-1')));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ configured: true, fallbackModelId: 'fb-model', lastProbe: PROBE });
    expect(mockGetApiKey).toHaveBeenCalledWith('org-1', 'bedrock');
    expect(mockGetBedrockConfig).toHaveBeenCalledWith('org-1');
  });

  it('NEVER returns the key — no key field on the response', async () => {
    mockGetApiKey.mockResolvedValue('super-secret-bearer-token');
    mockGetBedrockConfig.mockResolvedValue({ orgId: 'org-1', fallbackModelId: 'fb-model' });

    const res = parse(await getBedrockConfigStatus(makeEvent('org-1')));

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('super-secret-bearer-token');
    expect(res.body).not.toHaveProperty('apiKey');
    expect(res.body).not.toHaveProperty('key');
    expect(Object.keys(res.body).sort()).toEqual(['configured', 'fallbackModelId']);
  });

  it('reports configured=false when no key is stored', async () => {
    mockGetApiKey.mockResolvedValue(null);
    mockGetBedrockConfig.mockResolvedValue(null);

    const res = parse(await getBedrockConfigStatus(makeEvent('org-1')));

    expect(res.statusCode).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.fallbackModelId).toBeUndefined();
    expect(res.body.lastProbe).toBeUndefined();
  });

  it('returns 400 when orgId is missing from the query', async () => {
    const res = parse(await getBedrockConfigStatus(makeEvent(undefined)));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('orgId is required');
    expect(mockGetApiKey).not.toHaveBeenCalled();
  });
});
