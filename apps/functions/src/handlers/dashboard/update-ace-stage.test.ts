jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(),
  setAuditContext: jest.fn(),
}));

const mockSetAceStageLocal = jest.fn();
const mockSyncAceStage = jest.fn();
jest.mock('@/helpers/ace-stage', () => ({
  setAceStageLocal: (...args: unknown[]) => mockSetAceStageLocal(...args),
  syncAceStageToPartnerCentral: (...args: unknown[]) => mockSyncAceStage(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './update-ace-stage';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: Record<string, unknown>, userId = 'user-1'): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: {},
    headers: {},
    auth: { userId, orgId: (body.orgId as string) ?? undefined },
    rbac: { role: 'ADMIN', permissions: ['opportunity:edit'] },
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
  }) as unknown as AuthedEvent;

const base = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

const updatedItem = {
  oppId: 'opp-1',
  aceStage: 'Qualified',
  aceStageHistory: [
    { from: 'Prospect', to: 'Qualified', changedAt: '2026-08-05T00:00:00Z', changedBy: 'user-1', source: 'MANUAL' },
  ],
};

describe('update-ace-stage', () => {
  beforeEach(() => {
    mockSetAceStageLocal.mockReset();
    mockSyncAceStage.mockReset();
    (setAuditContext as jest.Mock).mockClear();
    mockSetAceStageLocal.mockResolvedValue(updatedItem);
    mockSyncAceStage.mockResolvedValue(true);
  });

  it('returns 400 for an invalid ACE stage', async () => {
    const response = await baseHandler(makeEvent({ ...base, aceStage: 'PROSPECT' }));
    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockSetAceStageLocal).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing', async () => {
    const response = await baseHandler(
      makeEvent({ projectId: 'proj-1', oppId: 'opp-1', aceStage: 'Qualified' }),
    );
    expect(response).toMatchObject({ statusCode: 400 });
  });

  it('sets the stage locally and pushes to Partner Central', async () => {
    const response = await baseHandler(makeEvent({ ...base, aceStage: 'Qualified' }));
    expect(mockSetAceStageLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        to: 'Qualified',
        source: 'MANUAL',
        changedBy: 'user-1',
      }),
    );
    expect(mockSyncAceStage).toHaveBeenCalledWith(
      expect.objectContaining({ aceStage: 'Qualified', item: updatedItem }),
    );
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body).toMatchObject({ ok: true, oppId: 'opp-1', aceSynced: true });
  });

  it('accepts every one of the 7 ACE stages', async () => {
    const stages = [
      'Prospect', 'Qualified', 'Technical Validation',
      'Business Validation', 'Committed', 'Launched', 'Closed Lost',
    ];
    for (const aceStage of stages) {
      const response = await baseHandler(makeEvent({ ...base, aceStage }));
      expect(response).toMatchObject({ statusCode: 200 });
    }
    expect(mockSetAceStageLocal).toHaveBeenCalledTimes(stages.length);
  });

  it('logs an OPPORTUNITY_ACE_STAGE_CHANGED audit event', async () => {
    await baseHandler(makeEvent({ ...base, aceStage: 'Qualified' }));
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'OPPORTUNITY_ACE_STAGE_CHANGED',
        resource: 'opportunity',
        resourceId: 'opp-1',
        orgId: 'org-1',
        changes: { before: { aceStage: 'Prospect' }, after: { aceStage: 'Qualified' } },
      }),
    );
  });

  it('returns 404 when the opportunity does not exist', async () => {
    mockSetAceStageLocal.mockRejectedValueOnce(
      new Error('Opportunity not found: orgId=org-1, projectId=proj-1, oppId=opp-1'),
    );
    const response = await baseHandler(makeEvent({ ...base, aceStage: 'Qualified' }));
    expect(response).toMatchObject({ statusCode: 404 });
    expect(mockSyncAceStage).not.toHaveBeenCalled();
  });

  it('still returns 200 with aceSynced=false when the Partner Central push fails', async () => {
    mockSyncAceStage.mockResolvedValueOnce(false);
    const response = await baseHandler(makeEvent({ ...base, aceStage: 'Committed' }));
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.aceSynced).toBe(false);
    expect(body.ok).toBe(true);
  });

  it('returns 500 on an unexpected error', async () => {
    mockSetAceStageLocal.mockRejectedValueOnce(new Error('DynamoDB down'));
    const response = await baseHandler(makeEvent({ ...base, aceStage: 'Qualified' }));
    expect(response).toMatchObject({ statusCode: 500 });
  });
});
