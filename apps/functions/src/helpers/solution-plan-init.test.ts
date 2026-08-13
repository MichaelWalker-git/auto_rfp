const mockGetPlan = jest.fn();
const mockPutPlan = jest.fn();
const mockDeleteMessages = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
  putSolutionPlan: (...a: unknown[]) => mockPutPlan(...a),
  deleteGrillingMessages: (...a: unknown[]) => mockDeleteMessages(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/solution-plan-queue', () => ({
  enqueueGrillingRound: (...a: unknown[]) => mockEnqueue(...a),
}));

const mockListQuestionFiles = jest.fn();
jest.mock('@/helpers/questionFile', () => ({
  listQuestionFilesByOpportunity: (...a: unknown[]) => mockListQuestionFiles(...a),
  isExtractedQuestionFile: (status: string | undefined) => status === 'PROCESSED',
}));

jest.mock('ulid', () => ({ ulid: () => 'run-ulid-fresh' }));

import { initSolutionPlanRun } from './solution-plan-init';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const readyPlan = {
  id: 'plan-1',
  ...key,
  status: 'READY',
  isStale: false,
  runId: 'run-old',
  contentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
  version: 2,
  isUserEdited: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  createdBy: 'user-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListQuestionFiles.mockResolvedValue({
    items: [{ textFileKey: 'text/key.txt', status: 'PROCESSED' }],
  });
  mockGetPlan.mockResolvedValue(null);
  mockPutPlan.mockImplementation((plan) => Promise.resolve(plan));
  mockDeleteMessages.mockResolvedValue(0);
});

describe('initSolutionPlanRun', () => {
  it('refuses when no processed solicitation documents exist', async () => {
    mockListQuestionFiles.mockResolvedValue({
      items: [{ textFileKey: 'text/key.txt', status: 'UPLOADED' }],
    });

    const result = await initSolutionPlanRun(key, { userId: 'user-9' });

    expect(result).toEqual({ outcome: 'NO_PROCESSED_FILES' });
    expect(mockPutPlan).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('creates a fresh plan, wipes the transcript, and enqueues round 1', async () => {
    const result = await initSolutionPlanRun(key, { userId: 'user-9' });

    expect(result).toMatchObject({ outcome: 'STARTED', regenerated: false, wipedMessages: 0 });
    const put = mockPutPlan.mock.calls[0][0];
    expect(put).toMatchObject({
      ...key,
      status: 'GRILLING',
      isStale: false,
      runId: 'run-ulid-fresh',
      version: 0,
      isUserEdited: false,
      grillingRounds: 0,
      createdBy: 'user-9',
      updatedBy: 'user-9',
    });
    expect(put.id).toEqual(expect.any(String));

    expect(mockDeleteMessages).toHaveBeenCalledWith(put.id);
    expect(mockEnqueue).toHaveBeenCalledWith({
      ...key,
      solutionPlanId: put.id,
      runId: 'run-ulid-fresh',
      round: 1,
      phase: 'GRILL',
    });
  });

  it('stamps the new runId BEFORE wiping the transcript (ADR-5 ordering)', async () => {
    const order: string[] = [];
    mockPutPlan.mockImplementation((plan) => {
      order.push('put');
      return Promise.resolve(plan);
    });
    mockDeleteMessages.mockImplementation(() => {
      order.push('wipe');
      return Promise.resolve(3);
    });
    mockEnqueue.mockImplementation(() => {
      order.push('enqueue');
      return Promise.resolve();
    });

    await initSolutionPlanRun(key, {});
    expect(order).toEqual(['put', 'wipe', 'enqueue']);
  });

  it('regenerates a READY plan in place: same id, monotonic version, fresh runId', async () => {
    mockGetPlan.mockResolvedValue(readyPlan);

    const result = await initSolutionPlanRun(key, { userId: 'user-9' });

    expect(result).toMatchObject({ outcome: 'STARTED', regenerated: true });
    const put = mockPutPlan.mock.calls[0][0];
    expect(put.id).toBe('plan-1'); // one plan id per opportunity, forever (ADR-2)
    expect(put.version).toBe(2); // never reset (ADR-11)
    expect(put.runId).not.toBe('run-old');
    expect(put.status).toBe('GRILLING');
    expect(put.isUserEdited).toBe(false);
    expect(put.contentKey).toBeUndefined(); // run-scoped fields reset
    expect(put.createdAt).toBe('2026-08-01T00:00:00.000Z');
    expect(put.createdBy).toBe('user-1');
  });

  it.each(['GRILLING', 'GENERATING_SOT'])(
    'refuses a re-init while a run is in flight (%s) and restart is not set',
    async (status) => {
      mockGetPlan.mockResolvedValue({ ...readyPlan, status });

      const result = await initSolutionPlanRun(key, {});

      expect(result).toEqual({ outcome: 'RUN_IN_PROGRESS', solutionPlanStatus: status });
      expect(mockPutPlan).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    },
  );

  it('re-inits an in-flight run when restart: true is passed (ADR-5)', async () => {
    mockGetPlan.mockResolvedValue({ ...readyPlan, status: 'GRILLING' });

    const result = await initSolutionPlanRun(key, { restart: true });

    expect(result).toMatchObject({ outcome: 'STARTED' });
    expect(mockPutPlan).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('re-inits a FAILED plan without a restart flag (retry path)', async () => {
    mockGetPlan.mockResolvedValue({ ...readyPlan, status: 'FAILED', error: 'boom' });

    const result = await initSolutionPlanRun(key, {});

    expect(result).toMatchObject({ outcome: 'STARTED' });
    const put = mockPutPlan.mock.calls[0][0];
    expect(put.error).toBeUndefined();
  });
});
