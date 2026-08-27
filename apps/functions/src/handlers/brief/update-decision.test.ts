/**
 * Tests for the update-decision handler (HOR-2729).
 *
 * The route hosts two request shapes: the original decision update, and the
 * folded-in "create-drive-folder" action (distinguished by the `action`
 * discriminator). Both branches are covered here.
 */
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));

const mockSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...a: unknown[]) => mockSend(...a) },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

const mockGetExecutiveBrief = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBrief: (...a: unknown[]) => mockGetExecutiveBrief(...a),
}));

const mockGetProjectById = jest.fn();
jest.mock('@/helpers/project', () => ({
  getProjectById: (...a: unknown[]) => mockGetProjectById(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/google-drive-queue', () => ({
  enqueueGoogleDriveSync: (...a: unknown[]) => mockEnqueue(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';

import { baseHandler } from './update-decision';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (body: unknown, orgId?: string): APIGatewayProxyEventV2 =>
  ({
    body: JSON.stringify(body),
    auth: { userId: 'user-1', ...(orgId ? { orgId } : {}), claims: {} },
    headers: {},
    queryStringParameters: {},
  }) as unknown as APIGatewayProxyEventV2;

const briefFixture = {
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  sections: { summary: { data: { agency: 'DoD', title: 'Widget RFP' } } },
};

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): any => JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({});
  mockGetExecutiveBrief.mockResolvedValue(briefFixture);
  mockGetProjectById.mockResolvedValue({ id: 'proj-1', name: 'Project One' });
  mockEnqueue.mockResolvedValue(undefined);
});

describe('update-decision — decision branch', () => {
  it('updates the decision and returns 200', async () => {
    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1', decision: 'NO_GO' }, 'org-1'));

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).decision).toBe('NO_GO');
    // No Drive sync for a non-GO decision.
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does NOT create a Drive folder on a GO decision (manual button only — HOR-2729)', async () => {
    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1', decision: 'GO' }, 'org-1'));

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).decision).toBe('GO');
    // A GO decision no longer auto-syncs — the folder is created only via the
    // explicit "Create Drive folder" action.
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns 500 on an invalid decision payload', async () => {
    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1', decision: 'MAYBE' }, 'org-1'));

    expect(statusOf(res)).toBe(500);
    expect(bodyOf(res).ok).toBe(false);
  });
});

describe('update-decision — create-drive-folder action branch', () => {
  it('enqueues a Drive folder and returns 202', async () => {
    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', action: 'create-drive-folder' }, 'org-1'),
    );

    expect(statusOf(res)).toBe(202);
    expect(bodyOf(res).status).toBe('enqueued');
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', executiveBriefId: 'brief-1' }),
    );
    // The decision path must not run — no DynamoDB writes.
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('is idempotent — returns the existing folder URL', async () => {
    mockGetExecutiveBrief.mockResolvedValue({
      ...briefFixture,
      googleDriveFolderUrl: 'https://drive.google.com/drive/folders/abc',
    });

    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', action: 'create-drive-folder' }, 'org-1'),
    );

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).status).toBe('exists');
    expect(bodyOf(res).googleDriveFolderUrl).toBe('https://drive.google.com/drive/folders/abc');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1', action: 'create-drive-folder' }));

    expect(statusOf(res)).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns 404 when the brief does not exist', async () => {
    mockGetExecutiveBrief.mockResolvedValue(null);

    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', action: 'create-drive-folder' }, 'org-1'),
    );

    expect(statusOf(res)).toBe(404);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
