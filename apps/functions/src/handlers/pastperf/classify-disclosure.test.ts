jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

const mockClassifyDisclosure = jest.fn();
jest.mock('@/helpers/disclosure-classifier', () => ({
  classifyDisclosure: (...a: unknown[]) => mockClassifyDisclosure(...a),
}));

const mockSaveDisclosureProposal = jest.fn();
jest.mock('@/helpers/past-performance', () => ({
  saveDisclosureProposal: (...a: unknown[]) => mockSaveDisclosureProposal(...a),
}));

import { baseHandler } from './classify-disclosure';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const ORG = '22222222-2222-2222-2222-222222222222';
const PROJ = '11111111-1111-1111-1111-111111111111';

const makeEvent = (body: unknown): AuthedEvent =>
  ({ body: JSON.stringify(body), auth: { userId: 'user-1' } }) as unknown as AuthedEvent;

const parseBody = (res: unknown) => JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
  mockClassifyDisclosure.mockResolvedValue({ proposals: [], classified: 0, failed: [] });
  mockSaveDisclosureProposal.mockResolvedValue(true);
});

describe('classify-disclosure handler', () => {
  it('returns 400 on malformed JSON without throwing', async () => {
    const res = await baseHandler({ body: '{not json', auth: { userId: 'u' } } as unknown as AuthedEvent);
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockClassifyDisclosure).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid payload', async () => {
    const res = await baseHandler(makeEvent({ orgId: 'not-a-uuid' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockClassifyDisclosure).not.toHaveBeenCalled();
  });

  it('classifies and persists each proposal (happy path)', async () => {
    const proposals = [
      { projectId: PROJ, proposed: 'ANONYMIZED_ONLY', rationale: 'r', signals: [], confidence: 70 },
    ];
    mockClassifyDisclosure.mockResolvedValue({ proposals, classified: 1, failed: [] });

    const res = await baseHandler(makeEvent({ orgId: ORG, projectIds: [PROJ] }));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(mockClassifyDisclosure).toHaveBeenCalledWith(ORG, [PROJ], false);
    expect(mockSaveDisclosureProposal).toHaveBeenCalledWith(ORG, proposals[0]);
    expect(parseBody(res)).toMatchObject({ classified: 1, failed: [] });
  });

  it('does not persist anything when there are no proposals', async () => {
    const res = await baseHandler(makeEvent({ orgId: ORG }));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(mockSaveDisclosureProposal).not.toHaveBeenCalled();
  });

  it('does not 500 when one proposal fails to persist; folds it into failed', async () => {
    const good = { projectId: PROJ, proposed: 'NAMEABLE', rationale: 'r', signals: [], confidence: 90 };
    const bad = { projectId: '99999999-9999-9999-9999-999999999999', proposed: 'NAMEABLE', rationale: 'r', signals: [], confidence: 90 };
    mockClassifyDisclosure.mockResolvedValue({ proposals: [good, bad], classified: 2, failed: [] });
    // First persists, second is a skipped/hallucinated row (returns false).
    mockSaveDisclosureProposal.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await baseHandler(makeEvent({ orgId: ORG }));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(parseBody(res)).toMatchObject({ classified: 1, failed: [bad.projectId] });
  });

  it('does not 500 when a persist call rejects (transient DB error)', async () => {
    const good = { projectId: PROJ, proposed: 'NAMEABLE', rationale: 'r', signals: [], confidence: 90 };
    mockClassifyDisclosure.mockResolvedValue({ proposals: [good], classified: 1, failed: [] });
    mockSaveDisclosureProposal.mockRejectedValueOnce(new Error('throttled'));

    const res = await baseHandler(makeEvent({ orgId: ORG }));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(parseBody(res)).toMatchObject({ classified: 0, failed: [good.projectId] });
  });
});
