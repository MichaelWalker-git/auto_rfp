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
jest.mock('@/helpers/env', () => ({ requireEnv: (_k: string, d?: string) => d ?? 'test' }));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: (...a: unknown[]) => mockGetOpportunity(...a) }));

const mockRunChatReview = jest.fn();
jest.mock('@/helpers/compliance-review-engine', () => ({
  runChatReview: (...a: unknown[]) => mockRunChatReview(...a),
}));

const mockSavePair = jest.fn();
jest.mock('@/helpers/compliance-review', () => ({
  saveComplianceMessagePair: (...a: unknown[]) => mockSavePair(...a),
}));

const mockWriteAuditLog = jest.fn();
jest.mock('@/helpers/audit-log', () => ({ writeAuditLog: (...a: unknown[]) => mockWriteAuditLog(...a) }));
jest.mock('@/helpers/secret', () => ({ getHmacSecret: jest.fn().mockResolvedValue('secret') }));

import { baseHandler } from './chat';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const makeEvent = (body: unknown) =>
  ({
    queryStringParameters: query,
    body: JSON.stringify(body),
    auth: { userId: 'user-9', claims: { name: 'Jane' } },
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: { 'user-agent': 'jest' },
  }) as never;

const ASSISTANT_MSG_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpportunity.mockResolvedValue({ oppId: 'opp-1' });
  mockRunChatReview.mockResolvedValue({ answer: 'Here is what I found.', findings: [] });
  mockSavePair.mockResolvedValue({ assistantMsg: { messageId: ASSISTANT_MSG_ID } });
  mockWriteAuditLog.mockResolvedValue(undefined);
});

describe('chat handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await baseHandler({ queryStringParameters: {}, body: '{}' } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when the message body is invalid', async () => {
    const res = await baseHandler(makeEvent({ message: '' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockRunChatReview).not.toHaveBeenCalled();
  });

  it('returns 404 when the opportunity is missing', async () => {
    mockGetOpportunity.mockResolvedValue(null);
    const res = await baseHandler(makeEvent({ message: 'hi' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(mockRunChatReview).not.toHaveBeenCalled();
  });

  it('runs the review, persists the pair, and returns answer + messageId', async () => {
    mockRunChatReview.mockResolvedValue({ answer: 'The tech volume covers Section L.', findings: [] });
    const res = (await baseHandler(makeEvent({ message: 'does it cover Section L?' }))) as {
      statusCode: number;
      body: string;
    };
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.answer).toBe('The tech volume covers Section L.');
    expect(parsed.messageId).toBe(ASSISTANT_MSG_ID);
    expect(mockSavePair).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'does it cover Section L?', userId: 'user-9' }),
    );
  });

  it('substitutes a fallback answer when the model returns findings but no summary', async () => {
    const finding = (id: string) => ({
      findingId: id,
      fingerprint: `fp-${id}`,
      targetKind: 'RFP_DOCUMENT',
      issueType: 'POOR_ANSWER',
      severity: 'minor',
      title: 't',
      description: 'd',
      anchorValid: false,
    });
    mockRunChatReview.mockResolvedValue({
      answer: '   ',
      findings: [finding('f1'), finding('f2')],
    });
    const res = (await baseHandler(makeEvent({ message: 'check forms' }))) as { statusCode: number; body: string };
    const parsed = JSON.parse(res.body);
    expect(parsed.answer).toContain('2 potential issues');
    // The persisted answer matches the returned one (no blank bubble).
    expect(mockSavePair).toHaveBeenCalledWith(
      expect.objectContaining({ assistantAnswer: expect.stringContaining('2 potential issues') }),
    );
  });

  it('writes a COMPLIANCE_REVIEW_MESSAGE_SENT audit log (non-blocking)', async () => {
    await baseHandler(makeEvent({ message: 'hi' }));
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPLIANCE_REVIEW_MESSAGE_SENT',
        resource: 'compliance_review_chat',
        resourceId: ASSISTANT_MSG_ID,
      }),
      'secret',
    );
  });

  it('still returns 200 when the audit write fails (non-blocking)', async () => {
    mockWriteAuditLog.mockRejectedValue(new Error('ddb down'));
    const res = await baseHandler(makeEvent({ message: 'hi' }));
    expect((res as { statusCode: number }).statusCode).toBe(200);
  });
});
