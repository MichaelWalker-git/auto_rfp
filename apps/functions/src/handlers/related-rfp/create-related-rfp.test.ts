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
const mockCreateRelatedRfp = jest.fn();
const mockResolveLinkedOpportunityId = jest.fn();
jest.mock('@/helpers/related-rfp', () => ({
  createRelatedRfp: (...args: unknown[]) => mockCreateRelatedRfp(...args),
  resolveLinkedOpportunityId: (...args: unknown[]) => mockResolveLinkedOpportunityId(...args),
}));

const mockResolveUserNames = jest.fn();
jest.mock('@/helpers/resolve-users', () => ({
  resolveUserNames: (...args: unknown[]) => mockResolveUserNames(...args),
}));

jest.mock('@/helpers/api', () => ({
  ...jest.requireActual('@/helpers/api'),
  getUserId: () => 'user-1',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './create-related-rfp';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: unknown): AuthedEvent =>
  ({
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {},
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
  }) as unknown as AuthedEvent;

const validBody = {
  orgId: 'org',
  projectId: 'p',
  oppId: 'o',
  relatedOppKey: 'OPP-2',
  title: 'Past RFP',
};

describe('create-related-rfp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveUserNames.mockResolvedValue({ 'user-1': 'Alice' });
    mockResolveLinkedOpportunityId.mockResolvedValue(null);
    mockCreateRelatedRfp.mockImplementation(async (dto) => ({ id: 'new-id', ...dto }));
  });

  it('returns 400 when body is missing', async () => {
    const res = await baseHandler(makeEvent(undefined));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 on validation error', async () => {
    const res = await baseHandler(makeEvent({ orgId: 'org' }));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('forces origin=MANUAL even if client sends AUTO', async () => {
    await baseHandler(makeEvent({ ...validBody, origin: 'AUTO' }));
    expect(mockCreateRelatedRfp).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'MANUAL', relatedOppKey: 'OPP-2' }),
    );
  });

  it('creates the link and returns 201', async () => {
    const res = await baseHandler(makeEvent(validBody));
    expect(res).toMatchObject({ statusCode: 201 });
    expect(mockResolveLinkedOpportunityId).toHaveBeenCalledWith('org', 'OPP-2');
    expect(mockSetAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'RELATED_RFP_ADDED', resource: 'opportunity' }),
    );
  });
});
