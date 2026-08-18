jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (fn: unknown) => fn }));
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({}),
  setAuditContext: (...args: unknown[]) => mockSetAuditContext(...args),
}));

const mockSetAuditContext = jest.fn();
const mockGetRelatedRfp = jest.fn();
const mockDeleteRelatedRfp = jest.fn();
const mockAddSuppression = jest.fn();
jest.mock('@/helpers/related-rfp', () => ({
  getRelatedRfp: (...args: unknown[]) => mockGetRelatedRfp(...args),
  deleteRelatedRfp: (...args: unknown[]) => mockDeleteRelatedRfp(...args),
  addSuppression: (...args: unknown[]) => mockAddSuppression(...args),
}));

jest.mock('@/helpers/api', () => ({
  ...jest.requireActual('@/helpers/api'),
  getUserId: () => 'user-1',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './delete-related-rfp';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (
  qs: Record<string, string | undefined>,
  relatedOppKey: string | undefined,
  permissions: string[],
): AuthedEvent =>
  ({
    pathParameters: relatedOppKey ? { relatedOppKey } : {},
    queryStringParameters: qs,
    headers: {},
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
    rbac: { role: 'EDITOR', permissions },
  }) as unknown as AuthedEvent;

const qs = { orgId: 'org', projectId: 'p', oppId: 'o' };

describe('delete-related-rfp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteRelatedRfp.mockResolvedValue(undefined);
    mockAddSuppression.mockResolvedValue(undefined);
  });

  it('returns 400 when relatedOppKey missing', async () => {
    const res = await baseHandler(makeEvent(qs, undefined, ['opportunity:edit']));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 404 when link not found', async () => {
    mockGetRelatedRfp.mockResolvedValueOnce(undefined);
    const res = await baseHandler(makeEvent(qs, 'OPP-2', ['opportunity:edit']));
    expect(res).toMatchObject({ statusCode: 404 });
  });

  it('removes a MANUAL link without needing admin perm and without tombstone', async () => {
    mockGetRelatedRfp.mockResolvedValueOnce({ origin: 'MANUAL', relatedOppKey: 'OPP-2' });
    const res = await baseHandler(makeEvent(qs, 'OPP-2', ['opportunity:edit']));
    expect(res).toMatchObject({ statusCode: 200 });
    expect(mockDeleteRelatedRfp).toHaveBeenCalledWith('org', 'p', 'o', 'OPP-2');
    expect(mockAddSuppression).not.toHaveBeenCalled();
  });

  it('blocks removing an AUTO link without related_rfp:remove_auto', async () => {
    mockGetRelatedRfp.mockResolvedValueOnce({ origin: 'AUTO', relatedOppKey: 'OPP-2' });
    const res = await baseHandler(makeEvent(qs, 'OPP-2', ['opportunity:edit']));
    expect(res).toMatchObject({ statusCode: 403 });
    expect(mockDeleteRelatedRfp).not.toHaveBeenCalled();
  });

  it('removes an AUTO link with admin perm and writes a tombstone', async () => {
    mockGetRelatedRfp.mockResolvedValueOnce({ origin: 'AUTO', relatedOppKey: 'OPP-2' });
    const res = await baseHandler(
      makeEvent(qs, 'OPP-2', ['opportunity:edit', 'related_rfp:remove_auto']),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(mockDeleteRelatedRfp).toHaveBeenCalledWith('org', 'p', 'o', 'OPP-2');
    expect(mockAddSuppression).toHaveBeenCalledWith('org', 'p', 'o', 'OPP-2', 'user-1');
    expect(mockSetAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'RELATED_RFP_REMOVED' }),
    );
  });

  it('decodes an URL-encoded relatedOppKey', async () => {
    mockGetRelatedRfp.mockResolvedValueOnce({ origin: 'MANUAL', relatedOppKey: 'OPP/2' });
    await baseHandler(makeEvent(qs, 'OPP%2F2', ['opportunity:edit']));
    expect(mockGetRelatedRfp).toHaveBeenCalledWith('org', 'p', 'o', 'OPP/2');
  });
});
