jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
  TransientServiceError: class extends Error {},
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockGetForm = jest.fn();
const mockUpdateForm = jest.fn();
const mockListForms = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  getRequiredForm: (...args: unknown[]) => mockGetForm(...args),
  updateRequiredForm: (...args: unknown[]) => mockUpdateForm(...args),
  listRequiredFormsByOpportunity: (...args: unknown[]) => mockListForms(...args),
}));

const mockRollup = jest.fn();
jest.mock('@/helpers/notary-wiring', () => ({
  rollupOpportunityNotary: (...args: unknown[]) => mockRollup(...args),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string>; body?: string | null }) => {
    if (event.queryStringParameters?.orgId) return event.queryStringParameters.orgId;
    if (event.body) {
      try {
        return JSON.parse(event.body).orgId;
      } catch {
        return undefined;
      }
    }
    return undefined;
  },
  parseJsonBody: (event: { body?: string | null }) => {
    if (!event.body) return undefined;
    try {
      return JSON.parse(event.body);
    } catch {
      return undefined;
    }
  },
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { setFormNotary } from './set-form-notary';

const event = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
  ({ body: JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2;

const validBody = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  formId: 'form-1',
  notaryStatus: 'NOT_REQUIRED',
};

const parse = (res: unknown): { statusCode: number; body: Record<string, unknown> } => {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetForm.mockResolvedValue({ formId: 'form-1', name: 'Cert' });
  mockUpdateForm.mockResolvedValue({ formId: 'form-1', notaryStatus: 'NOT_REQUIRED', notarySource: 'USER_SET' });
  mockListForms.mockResolvedValue([{ formId: 'form-1', notaryStatus: 'NOT_REQUIRED' }]);
  mockRollup.mockResolvedValue(undefined);
});

describe('setFormNotary', () => {
  it('patches the form with the chosen status and USER_SET source', async () => {
    const { statusCode, body } = parse(await setFormNotary(event(validBody)));

    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ formId: 'form-1', notaryStatus: 'NOT_REQUIRED', notarySource: 'USER_SET' });
    expect(mockUpdateForm).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      formId: 'form-1',
      patch: { notaryStatus: 'NOT_REQUIRED', notarySource: 'USER_SET' },
    });
  });

  it('recomputes the opportunity rollup with the notification SUPPRESSED', async () => {
    await setFormNotary(event({ ...validBody, notaryStatus: 'REQUIRED' }));

    expect(mockRollup).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', notify: false }),
    );
  });

  it('returns 400 when orgId is missing', async () => {
    const { orgId: _omitted, ...noOrg } = validBody;
    const { statusCode } = parse(await setFormNotary(event(noOrg)));
    expect(statusCode).toBe(400);
    expect(mockUpdateForm).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid notaryStatus', async () => {
    const { statusCode } = parse(await setFormNotary(event({ ...validBody, notaryStatus: 'MAYBE' })));
    expect(statusCode).toBe(400);
    expect(mockUpdateForm).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-JSON body', async () => {
    const { statusCode } = parse(
      await setFormNotary({ body: '{not-json' } as unknown as APIGatewayProxyEventV2),
    );
    expect(statusCode).toBe(400);
  });

  it('returns 404 when the form does not exist', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const { statusCode } = parse(await setFormNotary(event(validBody)));
    expect(statusCode).toBe(404);
    expect(mockUpdateForm).not.toHaveBeenCalled();
  });

  it('still succeeds when the rollup recompute fails (best-effort)', async () => {
    mockListForms.mockRejectedValueOnce(new Error('list failed'));
    const { statusCode } = parse(await setFormNotary(event(validBody)));
    expect(statusCode).toBe(200);
  });
});
