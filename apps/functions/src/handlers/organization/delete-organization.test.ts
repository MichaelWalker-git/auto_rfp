/**
 * Unit tests for the delete-organization handler.
 *
 * Deleting an org cascades a full project cleanup per project inside a single
 * 30-second API Gateway request, so the handler must run those cleanups with
 * bounded concurrency rather than strictly one after another, and must still
 * delete the org record itself once the projects are gone.
 */

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({ before: jest.fn() }),
  httpErrorMiddleware: () => ({ onError: jest.fn() }),
  orgMembershipMiddleware: () => ({ before: jest.fn() }),
  requirePermission: () => ({ before: jest.fn() }),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({ after: jest.fn() }),
  setAuditContext: jest.fn(),
}));

jest.mock('@/helpers/db', () => ({
  deleteItemWithRetry: jest.fn(),
}));

jest.mock('@/helpers/project-cleanup', () => ({
  deleteProjectAndRelatedEntities: jest.fn(),
  extractProjectIdFromSk: (sk: string, orgId: string) =>
    sk.startsWith(`${orgId}#`) ? sk.slice(orgId.length + 1) : null,
  getProjectsByOrgId: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './delete-organization';
import { deleteItemWithRetry } from '@/helpers/db';
import { deleteProjectAndRelatedEntities, getProjectsByOrgId } from '@/helpers/project-cleanup';
import { setAuditContext } from '@/middleware/audit-middleware';
import { ORG_PK } from '@/constants/organization';
import { PK_NAME, SK_NAME } from '@/constants/common';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const mockDeleteItem = deleteItemWithRetry as jest.MockedFunction<typeof deleteItemWithRetry>;
const mockDeleteProject = deleteProjectAndRelatedEntities as jest.MockedFunction<
  typeof deleteProjectAndRelatedEntities
>;
const mockGetProjects = getProjectsByOrgId as jest.MockedFunction<typeof getProjectsByOrgId>;

const ORG_ID = 'org-1';

const projectItem = (projectId: string) => ({
  [PK_NAME]: 'PROJECT',
  [SK_NAME]: `${ORG_ID}#${projectId}`,
  projectId,
});

const makeEvent = (id?: string): AuthedEvent =>
  ({
    pathParameters: id ? { id } : {},
    queryStringParameters: {},
    headers: {},
    requestContext: {},
  }) as unknown as AuthedEvent;

const parseBody = (response: unknown) => {
  const r = response as { statusCode: number; body?: string };
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteItem.mockResolvedValue(true);
  mockGetProjects.mockResolvedValue([]);
  mockDeleteProject.mockResolvedValue({} as never);
});

describe('delete-organization', () => {
  it('returns 400 when the id path parameter is missing', async () => {
    const { status } = parseBody(await baseHandler(makeEvent()));

    expect(status).toBe(400);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('deletes every project and then the organization record', async () => {
    mockGetProjects.mockResolvedValue([projectItem('p1'), projectItem('p2'), projectItem('p3')]);

    const { status, body } = parseBody(await baseHandler(makeEvent(ORG_ID)));

    expect(status).toBe(200);
    expect(mockDeleteProject).toHaveBeenCalledTimes(3);
    for (const id of ['p1', 'p2', 'p3']) {
      expect(mockDeleteProject).toHaveBeenCalledWith(ORG_ID, id);
    }
    expect(mockDeleteItem).toHaveBeenCalledWith(ORG_PK, `ORG#${ORG_ID}`);
    expect(body.cleanup).toEqual({
      projects: { total: 3, deleted: 3, failed: 0 },
      organization: true,
    });
  });

  it('runs project cleanups concurrently, but with a bounded pool', async () => {
    const projects = Array.from({ length: 10 }, (_, i) => projectItem(`p${i}`));
    mockGetProjects.mockResolvedValue(projects);

    let inFlight = 0;
    let peak = 0;
    mockDeleteProject.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return {} as never;
    });

    await baseHandler(makeEvent(ORG_ID));

    expect(mockDeleteProject).toHaveBeenCalledTimes(10);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('counts a failed project cleanup without aborting the rest', async () => {
    mockGetProjects.mockResolvedValue([projectItem('good'), projectItem('bad'), projectItem('good2')]);
    mockDeleteProject.mockImplementation(async (_orgId, projectId) => {
      if (projectId === 'bad') throw new Error('boom');
      return {} as never;
    });

    const { status, body } = parseBody(await baseHandler(makeEvent(ORG_ID)));

    expect(status).toBe(200);
    expect(body.cleanup.projects).toEqual({ total: 3, deleted: 2, failed: 1 });
    expect(mockDeleteItem).toHaveBeenCalledWith(ORG_PK, `ORG#${ORG_ID}`);
  });

  it('falls back to the sort key when the project item has no projectId', async () => {
    mockGetProjects.mockResolvedValue([
      { [PK_NAME]: 'PROJECT', [SK_NAME]: `${ORG_ID}#from-sk` },
    ]);

    await baseHandler(makeEvent(ORG_ID));

    expect(mockDeleteProject).toHaveBeenCalledWith(ORG_ID, 'from-sk');
  });

  it('records the deleted org id in the audit context', async () => {
    await baseHandler(makeEvent(ORG_ID));

    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resource: 'organization', resourceId: ORG_ID }),
    );
  });
});
