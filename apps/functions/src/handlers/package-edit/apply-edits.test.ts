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

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: (...a: unknown[]) => mockGetOpportunity(...a) }));

const mockGetRunById = jest.fn();
const mockMarkEditsApplied = jest.fn();
jest.mock('@/helpers/package-edit', () => ({
  getProposalRunById: (...a: unknown[]) => mockGetRunById(...a),
  markEditsApplied: (...a: unknown[]) => mockMarkEditsApplied(...a),
}));

const mockApplyEdits = jest.fn();
jest.mock('@/helpers/package-edit-apply', () => ({ applyEdits: (...a: unknown[]) => mockApplyEdits(...a) }));

const mockAudit = jest.fn();
jest.mock('@/helpers/package-edit-audit', () => ({ writePackageEditAuditLog: (...a: unknown[]) => mockAudit(...a) }));

import { baseHandler } from './apply-edits';

const query = { orgId: 'o', projectId: 'p', opportunityId: 'opp' };
const makeEvent = (body: unknown) =>
  ({
    queryStringParameters: query,
    body: JSON.stringify(body),
    auth: { userId: 'u1', claims: { name: 'Jane' } },
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: {},
  }) as never;

const proposals = [
  { editId: 'e1', target: { kind: 'RFP_DOCUMENT', documentId: 'doc-1' }, before: 'a', after: 'b', rationale: '', advisoryOnly: false },
  { editId: 'e2', target: { kind: 'FORM', formId: 'form-1', fieldId: 'fld-1' }, before: 'x', after: 'y', rationale: '', advisoryOnly: false },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpportunity.mockResolvedValue({ oppId: 'opp' });
  mockGetRunById.mockResolvedValue({ runId: 'run-1', proposals });
  mockApplyEdits.mockResolvedValue([{ editId: 'e1', status: 'applied', newVersionNumber: 6 }]);
  mockMarkEditsApplied.mockResolvedValue(undefined);
  mockAudit.mockResolvedValue(undefined);
});

describe('apply-edits handler', () => {
  it('returns 400 on missing editIds', async () => {
    const res = await baseHandler(makeEvent({ runId: 'run-1', editIds: [] }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('SG-1: returns 400 (not 500) on malformed JSON body', async () => {
    const res = await baseHandler({ queryStringParameters: query, body: '{bad' } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 404 when the run is missing', async () => {
    mockGetRunById.mockResolvedValueOnce(null);
    const res = await baseHandler(makeEvent({ runId: 'nope', editIds: ['e1'] }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 400 when none of the editIds belong to the run', async () => {
    const res = await baseHandler(makeEvent({ runId: 'run-1', editIds: ['zzz'] }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });

  it('applies the requested subset and returns per-target results', async () => {
    const res = await baseHandler(makeEvent({ runId: 'run-1', editIds: ['e1'] }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe('applied');
    // only e1 passed to applyEdits
    expect(mockApplyEdits.mock.calls[0][0].edits.map((e: { editId: string }) => e.editId)).toEqual(['e1']);
  });

  it('writes an audit entry for each applied edit', async () => {
    await baseHandler(makeEvent({ runId: 'run-1', editIds: ['e1'] }));
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PACKAGE_EDIT_APPLIED', resource: 'rfp_document' }),
    );
  });

  it('does NOT audit skipped/failed edits', async () => {
    mockApplyEdits.mockResolvedValueOnce([{ editId: 'e1', status: 'skipped-stale' }]);
    await baseHandler(makeEvent({ runId: 'run-1', editIds: ['e1'] }));
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('persists applied editIds back onto the run', async () => {
    await baseHandler(makeEvent({ runId: 'run-1', editIds: ['e1'] }));
    expect(mockMarkEditsApplied).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      ['e1'],
    );
  });

  it('does NOT persist applied editIds when nothing applied', async () => {
    mockApplyEdits.mockResolvedValueOnce([{ editId: 'e1', status: 'skipped-stale' }]);
    await baseHandler(makeEvent({ runId: 'run-1', editIds: ['e1'] }));
    expect(mockMarkEditsApplied).not.toHaveBeenCalled();
  });
});
