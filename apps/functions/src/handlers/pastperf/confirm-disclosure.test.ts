jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

const mockSetAuditContext = jest.fn();
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: (...a: unknown[]) => mockSetAuditContext(...a),
}));

const mockConfirmDisclosureRows = jest.fn();
jest.mock('@/helpers/past-performance', () => ({
  confirmDisclosureRows: (...a: unknown[]) => mockConfirmDisclosureRows(...a),
}));

jest.mock('@/helpers/date', () => ({
  nowIso: () => '2026-08-17T00:00:00.000Z',
}));

import { baseHandler } from './confirm-disclosure';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const ORG = '22222222-2222-2222-2222-222222222222';
const PROJ = '11111111-1111-1111-1111-111111111111';

const makeEvent = (body: unknown, userId = 'user-1'): AuthedEvent =>
  ({ body: JSON.stringify(body), auth: { userId } }) as unknown as AuthedEvent;

const parseBody = (res: unknown) => JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirmDisclosureRows.mockResolvedValue(1);
});

describe('confirm-disclosure handler', () => {
  it('returns 400 on malformed JSON without throwing', async () => {
    const res = await baseHandler({ body: '{not json', auth: { userId: 'u' } } as unknown as AuthedEvent);
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockConfirmDisclosureRows).not.toHaveBeenCalled();
  });

  it('returns 400 when rows are empty', async () => {
    const res = await baseHandler(makeEvent({ orgId: ORG, rows: [] }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockConfirmDisclosureRows).not.toHaveBeenCalled();
  });

  it('confirms rows with the reviewer stamp and records an audit entry', async () => {
    const rows = [{ projectId: PROJ, disclosure: 'NAMEABLE' }];
    const res = await baseHandler(makeEvent({ orgId: ORG, rows }));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(mockConfirmDisclosureRows).toHaveBeenCalledWith(
      ORG,
      rows,
      'user-1',
      '2026-08-17T00:00:00.000Z',
    );
    expect(mockSetAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'PAST_PERF_DISCLOSURE_CONFIRMED',
        resource: 'past_project',
      }),
    );
    expect(parseBody(res)).toEqual({ confirmed: 1 });
  });

  it('falls back to "system" when no user is on the event', async () => {
    await baseHandler({ body: JSON.stringify({ orgId: ORG, rows: [{ projectId: PROJ, disclosure: 'DO_NOT_USE' }] }) } as unknown as AuthedEvent);
    expect(mockConfirmDisclosureRows).toHaveBeenCalledWith(
      ORG,
      expect.any(Array),
      'system',
      expect.any(String),
    );
  });
});
