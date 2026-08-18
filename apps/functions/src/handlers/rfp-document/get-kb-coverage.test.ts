jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockBuildReport = jest.fn();
jest.mock('@/helpers/kb-coverage', () => ({
  buildKBCoverageReport: (...a: unknown[]) => mockBuildReport(...a),
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { baseHandler } from './get-kb-coverage';

const report = {
  snapshot: {
    PERSONNEL_BIOS: { present: false, count: 0 },
    CERTIFICATIONS: { present: true, count: 2 },
    INSURANCE: { present: false, count: 0 },
  },
  byDocumentType: {
    TEAM_QUALIFICATIONS: {
      covered: false,
      missing: [{ key: 'PERSONNEL_BIOS', label: 'personnel bios' }],
    },
    CERTIFICATIONS: { covered: true, missing: [] },
  },
  isGateEnabled: false,
};

const buildEvent = (queryStringParameters?: Record<string, string>): APIGatewayProxyEventV2 =>
  ({ queryStringParameters }) as unknown as APIGatewayProxyEventV2;

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildReport.mockResolvedValue(report);
});

describe('get-kb-coverage handler', () => {
  it('should return the coverage report for the org', async () => {
    const res = await baseHandler(buildEvent({ orgId: 'org-1' }));

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, ...report });
    expect(mockBuildReport).toHaveBeenCalledWith('org-1');
  });

  it('should name the gaps per document type so one call serves both consumers', async () => {
    const res = await baseHandler(buildEvent({ orgId: 'org-1' }));

    expect(bodyOf(res)).toMatchObject({
      byDocumentType: {
        TEAM_QUALIFICATIONS: {
          covered: false,
          missing: [{ key: 'PERSONNEL_BIOS', label: 'personnel bios' }],
        },
      },
    });
  });

  it('should return 400 when orgId is absent', async () => {
    const res = await baseHandler(buildEvent());

    expect(statusOf(res)).toBe(400);
    expect(mockBuildReport).not.toHaveBeenCalled();
  });

  it('should return 500 when the probe throws', async () => {
    mockBuildReport.mockRejectedValue(new Error('dynamo exploded'));

    const res = await baseHandler(buildEvent({ orgId: 'org-1' }));

    expect(statusOf(res)).toBe(500);
    expect(bodyOf(res)).toMatchObject({ ok: false, error: 'dynamo exploded' });
  });
});
