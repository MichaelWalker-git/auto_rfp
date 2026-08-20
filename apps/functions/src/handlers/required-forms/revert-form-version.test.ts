jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h, TransientServiceError: class extends Error {} }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockRevert = jest.fn();
jest.mock('@/helpers/required-form-version', () => ({
  revertFormToVersion: (...a: unknown[]) => mockRevert(...a),
}));

const mockAudit = jest.fn();
jest.mock('@/helpers/package-edit-audit', () => ({ writePackageEditAuditLog: (...a: unknown[]) => mockAudit(...a) }));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (e: { queryStringParameters?: Record<string, string> }) => e.queryStringParameters?.orgId,
  getUserId: () => 'u1',
  // Mirror the real parseJsonBody: takes the event, returns the parsed value or
  // `undefined` on malformed JSON (absent body → {}).
  parseJsonBody: (event: { body?: string | null }) => {
    if (!event.body) return {};
    try {
      return JSON.parse(event.body);
    } catch {
      return undefined;
    }
  },
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { NotFoundError } from '@/helpers/error';
import { baseHandler } from './revert-form-version';

const makeEvent = (body: unknown) =>
  ({
    queryStringParameters: { orgId: 'o' },
    body: JSON.stringify(body),
    auth: { claims: { name: 'Jane' } },
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: {},
  }) as unknown as APIGatewayProxyEventV2;

const validBody = { formId: 'f', projectId: 'p', opportunityId: 'opp', targetVersion: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  mockRevert.mockResolvedValue({ form: { formId: 'f' }, snapshotVersionNumber: 4 });
  mockAudit.mockResolvedValue(undefined);
});

describe('revert-form-version handler', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler({ body: JSON.stringify(validBody) } as never);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid body (targetVersion < 1)', async () => {
    const res = await baseHandler(makeEvent({ ...validBody, targetVersion: 0 }));
    expect(res.statusCode).toBe(400);
  });

  it('reverts and audits on success', async () => {
    const res = await baseHandler(makeEvent(validBody));
    expect(res.statusCode).toBe(200);
    expect(mockRevert).toHaveBeenCalledWith(
      expect.objectContaining({ formId: 'f', targetVersion: 2, userId: 'u1' }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FORM_VERSION_REVERTED' }),
    );
  });

  it('returns 404 when the helper throws a NotFoundError (classified by type, not message)', async () => {
    mockRevert.mockRejectedValueOnce(new NotFoundError('Form version 2 not found'));
    const res = await baseHandler(makeEvent(validBody));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body as string).message).toBe('Form version 2 not found');
  });

  it('does NOT map a generic error to 404 even if its message contains "not found"', async () => {
    // Regression: 404 must be driven by the error TYPE. A plain Error whose text
    // happens to say "not found" must bubble to the error middleware (500), not
    // be misclassified — and conversely a reworded NotFoundError still maps to 404.
    mockRevert.mockRejectedValueOnce(new Error('upstream table not found'));
    await expect(baseHandler(makeEvent(validBody))).rejects.toThrow('upstream table not found');
  });

  it('M1: forwards the user changeNote to the revert helper', async () => {
    await baseHandler(makeEvent({ ...validBody, changeNote: 'wrong data entered' }));
    expect(mockRevert).toHaveBeenCalledWith(
      expect.objectContaining({ changeNote: 'wrong data entered' }),
    );
  });
});
