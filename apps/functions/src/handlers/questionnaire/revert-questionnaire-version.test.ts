jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockRevert = jest.fn();
jest.mock('@/helpers/questionnaire-version', () => ({
  revertQuestionnaireToVersion: (...a: unknown[]) => mockRevert(...a),
}));

const mockAudit = jest.fn();
jest.mock('@/helpers/package-edit-audit', () => ({ writePackageEditAuditLog: (...a: unknown[]) => mockAudit(...a) }));

import { NotFoundError } from '@/helpers/error';
import { baseHandler } from './revert-questionnaire-version';

const makeEvent = (body: unknown, query: Record<string, string> = { orgId: 'o' }) =>
  ({
    queryStringParameters: query,
    body: JSON.stringify(body),
    auth: { userId: 'u1', claims: { name: 'Jane' } },
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: {},
  }) as never;

const validBody = { documentId: 'd', projectId: 'p', opportunityId: 'opp', targetVersion: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  mockRevert.mockResolvedValue({ snapshotVersionNumber: 3, fileKey: 'q/d.xlsx' });
  mockAudit.mockResolvedValue(undefined);
});

describe('revert-questionnaire-version handler', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(makeEvent(validBody, {}));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 on an invalid body (targetVersion < 1)', async () => {
    const res = await baseHandler(makeEvent({ ...validBody, targetVersion: 0 }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockRevert).not.toHaveBeenCalled();
  });

  it('reverts and writes an audit entry', async () => {
    const res = await baseHandler(makeEvent(validBody));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.documentId).toBe('d');
    expect(body.snapshotVersionNumber).toBe(3);
    expect(mockRevert).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'o', documentId: 'd', targetVersion: 1, userId: 'u1' }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'QUESTIONNAIRE_VERSION_REVERTED', resource: 'rfp_document' }),
    );
  });

  it('returns 404 when the helper throws a NotFoundError (classified by type, not message)', async () => {
    mockRevert.mockRejectedValueOnce(new NotFoundError('Questionnaire version 9 not found'));
    const res = await baseHandler(makeEvent({ ...validBody, targetVersion: 9 }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(JSON.parse((res as { body: string }).body).message).toBe('Questionnaire version 9 not found');
  });

  it('does NOT map a generic error to 404 even if its message contains "not found"', async () => {
    // Regression: a plain Error whose text happens to say "not found" must bubble
    // to the error middleware (500), not be misclassified as a 404.
    mockRevert.mockRejectedValueOnce(new Error('DynamoDB endpoint not found'));
    await expect(baseHandler(makeEvent(validBody))).rejects.toThrow('DynamoDB endpoint not found');
  });

  it('M1: forwards the user changeNote to the revert helper', async () => {
    await baseHandler(makeEvent({ ...validBody, changeNote: 'reverting bad AI edit' }));
    expect(mockRevert).toHaveBeenCalledWith(
      expect.objectContaining({ changeNote: 'reverting bad AI edit' }),
    );
  });
});
