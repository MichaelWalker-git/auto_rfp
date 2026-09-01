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

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({})),
  setAuditContext: jest.fn(),
}));

const mockStoreApiKey = jest.fn();
const mockDeleteApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  storeApiKey: (...args: unknown[]) => mockStoreApiKey(...args),
  deleteApiKey: (...args: unknown[]) => mockDeleteApiKey(...args),
}));

const mockUpsertBedrockConfig = jest.fn();
const mockDeleteBedrockConfig = jest.fn();
jest.mock('@/helpers/bedrock-config', () => ({
  upsertBedrockConfig: (...args: unknown[]) => mockUpsertBedrockConfig(...args),
  deleteBedrockConfig: (...args: unknown[]) => mockDeleteBedrockConfig(...args),
}));

const mockProbeBedrockKey = jest.fn();
jest.mock('@/helpers/bedrock-probe', () => ({
  probeBedrockKey: (...args: unknown[]) => mockProbeBedrockKey(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { saveBedrockConfig } from './set-config';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: unknown): AuthedEvent =>
  ({ body: body === undefined ? undefined : JSON.stringify(body) } as unknown as AuthedEvent);

const parse = (res: unknown) => {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
};

const ACCEPTED_PROBE = {
  probedAt: '2026-09-01T00:00:00.000Z',
  accepted: true,
  results: [{ modelId: 'amazon.titan-embed-text-v2:0', role: 'embeddings', ok: true }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreApiKey.mockReset().mockResolvedValue(undefined);
  mockDeleteApiKey.mockReset().mockResolvedValue(undefined);
  mockUpsertBedrockConfig.mockReset().mockResolvedValue({ orgId: 'org-1', fallbackModelId: 'fb-model' });
  mockDeleteBedrockConfig.mockReset().mockResolvedValue(undefined);
  // Default: the key passes the probe. Reject-path tests override this.
  mockProbeBedrockKey.mockReset().mockResolvedValue({ probe: ACCEPTED_PROBE, accepted: true, missing: [] });
});

describe('saveBedrockConfig', () => {
  it('stores the key + config on a valid save (happy path)', async () => {
    const res = parse(
      await saveBedrockConfig(makeEvent({ orgId: 'org-1', apiKey: 'bedrock-key', fallbackModelId: 'fb-model' })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, orgId: 'org-1', fallbackModelId: 'fb-model', probe: ACCEPTED_PROBE });
    expect(mockProbeBedrockKey).toHaveBeenCalledWith({ apiKey: 'bedrock-key', fallbackModelId: 'fb-model' });
    expect(mockStoreApiKey).toHaveBeenCalledWith('org-1', 'bedrock', 'bedrock-key');
    expect(mockUpsertBedrockConfig).toHaveBeenCalledWith({
      orgId: 'org-1',
      fallbackModelId: 'fb-model',
      lastProbe: ACCEPTED_PROBE,
    });
    expect(mockDeleteApiKey).not.toHaveBeenCalled();
    expect(mockDeleteBedrockConfig).not.toHaveBeenCalled();
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'API_KEY_CREATED', resource: 'api_key' }),
    );
  });

  it('saves without the optional fallbackModelId', async () => {
    mockUpsertBedrockConfig.mockResolvedValueOnce({ orgId: 'org-1' });
    const res = parse(await saveBedrockConfig(makeEvent({ orgId: 'org-1', apiKey: 'bedrock-key' })));

    expect(res.statusCode).toBe(200);
    expect(mockProbeBedrockKey).toHaveBeenCalledWith({ apiKey: 'bedrock-key', fallbackModelId: undefined });
    expect(mockStoreApiKey).toHaveBeenCalledWith('org-1', 'bedrock', 'bedrock-key');
    expect(mockUpsertBedrockConfig).toHaveBeenCalledWith({
      orgId: 'org-1',
      fallbackModelId: undefined,
      lastProbe: ACCEPTED_PROBE,
    });
  });

  it('rejects (422) with the missing-model list and stores nothing when the probe fails', async () => {
    const rejectedProbe = {
      probedAt: '2026-09-01T00:00:00.000Z',
      accepted: false,
      results: [
        { modelId: 'amazon.titan-embed-text-v2:0', role: 'embeddings', ok: true },
        { modelId: 'us.anthropic.claude-opus-4-6-v1', role: 'default', ok: false, error: 'AccessDeniedException' },
      ],
    };
    mockProbeBedrockKey.mockResolvedValueOnce({
      probe: rejectedProbe,
      accepted: false,
      missing: ['us.anthropic.claude-opus-4-6-v1'],
    });

    const res = parse(await saveBedrockConfig(makeEvent({ orgId: 'org-1', apiKey: 'bad-key' })));

    expect(res.statusCode).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.missingModels).toEqual(['us.anthropic.claude-opus-4-6-v1']);
    expect(res.body.probe).toEqual(rejectedProbe);
    // Nothing persisted, no audit, on reject.
    expect(mockStoreApiKey).not.toHaveBeenCalled();
    expect(mockUpsertBedrockConfig).not.toHaveBeenCalled();
    expect(setAuditContext).not.toHaveBeenCalled();
  });

  it('clears both secret and config when apiKey is empty (delete semantics)', async () => {
    const res = parse(await saveBedrockConfig(makeEvent({ orgId: 'org-1', apiKey: '' })));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, cleared: true, orgId: 'org-1' });
    expect(mockDeleteApiKey).toHaveBeenCalledWith('org-1', 'bedrock');
    expect(mockDeleteBedrockConfig).toHaveBeenCalledWith('org-1');
    expect(mockStoreApiKey).not.toHaveBeenCalled();
    expect(mockUpsertBedrockConfig).not.toHaveBeenCalled();
    expect(mockProbeBedrockKey).not.toHaveBeenCalled();
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'API_KEY_DELETED' }),
    );
  });

  it('treats whitespace-only apiKey as a clear', async () => {
    const res = parse(await saveBedrockConfig(makeEvent({ orgId: 'org-1', apiKey: '   ' })));
    expect(res.statusCode).toBe(200);
    expect(res.body.cleared).toBe(true);
    expect(mockDeleteApiKey).toHaveBeenCalledWith('org-1', 'bedrock');
  });

  it('returns 400 when the body is missing', async () => {
    const res = parse(await saveBedrockConfig(makeEvent(undefined)));
    expect(res.statusCode).toBe(400);
    expect(mockStoreApiKey).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const res = parse(await saveBedrockConfig({ body: '{not json' } as unknown as AuthedEvent));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Invalid JSON body');
  });

  it('returns 400 with issues when orgId is missing (validation)', async () => {
    const res = parse(await saveBedrockConfig(makeEvent({ apiKey: 'k' })));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Validation error');
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(mockStoreApiKey).not.toHaveBeenCalled();
  });

  it('rejects an empty fallbackModelId string (validation)', async () => {
    const res = parse(await saveBedrockConfig(makeEvent({ orgId: 'org-1', apiKey: 'k', fallbackModelId: '' })));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Validation error');
  });
});
