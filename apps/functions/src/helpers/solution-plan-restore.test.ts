/**
 * Tests for the restore-as-new orchestration (u3-version-restore, W1).
 *
 * Mocks u1's C3 helpers, the plan helper module (C4 primitive + reads), and
 * the S3 copy — all BEFORE imports — and exercises the exported pipeline
 * directly. Every row of the reliability design's failure-mode ledger has a
 * test: reads/guards fail → untouched + no side effects; copy fails →
 * untouched; C4 conditional fails after copy → untouched plan + orphaned copy
 * accepted; capture fails after the write → restore still succeeds (fail-open,
 * newVersion null). Pipeline ordering copy → write → capture is asserted via
 * call order.
 */

const mockGetPlan = jest.fn();
const mockRestoreContent = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
  restoreSolutionPlanContent: (...a: unknown[]) => mockRestoreContent(...a),
  // Real key convention — the destination-key assertions exercise the actual
  // v{n} pattern, not a mock's echo.
  buildSolutionPlanHtmlKey: (
    key: { orgId: string; projectId: string; opportunityId: string },
    version: number,
  ) =>
    `${key.orgId}/${key.projectId}/${key.opportunityId}/solution-plan/v${version}/solution-plan.html`,
}));

const mockGetVersion = jest.fn();
const mockListVersions = jest.fn();
const mockCapture = jest.fn();
jest.mock('@/helpers/solution-plan-version', () => ({
  getSolutionPlanVersion: (...a: unknown[]) => mockGetVersion(...a),
  listSolutionPlanVersions: (...a: unknown[]) => mockListVersions(...a),
  captureSolutionPlanVersion: (...a: unknown[]) => mockCapture(...a),
  toSolutionPlanVersionListItem: (item: Record<string, unknown>) => ({
    versionId: item.versionId,
    versionNumber: item.versionNumber,
    origin: item.origin,
    createdBy: item.createdBy,
    createdByName: item.createdByName,
    createdAt: item.createdAt,
  }),
}));

const mockCopyS3Object = jest.fn();
jest.mock('@/helpers/s3', () => ({
  copyS3Object: (...a: unknown[]) => mockCopyS3Object(...a),
}));

import type { SolutionPlanKey } from '@auto-rfp/core';

import { restoreSolutionPlanVersion } from './solution-plan-restore';

const key: SolutionPlanKey = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const readyPlan = (overrides: Record<string, unknown> = {}) => ({
  id: 'plan-1',
  ...key,
  status: 'READY',
  version: 7,
  contentKey: 'org-1/proj-1/opp-1/solution-plan/v7/solution-plan.html',
  ...overrides,
});

const sourceVersion = (overrides: Record<string, unknown> = {}) => ({
  versionId: 'ver-3',
  versionNumber: 3,
  ...key,
  solutionPlanId: 'plan-1',
  htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v3/solution-plan.html',
  origin: 'generation',
  createdBy: 'user-9',
  createdByName: 'Old Author',
  createdAt: '2026-08-20T00:00:00.000Z',
  ...overrides,
});

const capturedRecord = {
  versionId: 'ver-new',
  versionNumber: 8,
  ...key,
  solutionPlanId: 'plan-1',
  htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v8/solution-plan.html',
  origin: 'restore',
  createdBy: 'user-1',
  createdByName: 'Alice Example',
  createdAt: '2026-08-28T00:00:00.000Z',
};

const restoreInput = {
  key,
  versionId: 'ver-3',
  restoredBy: 'user-1',
  restoredByName: 'Alice Example',
  requestId: 'req-abc',
};

const conditionalError = () => {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
};

let infoSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

  // Happy-path defaults; individual tests override the failing step.
  mockGetPlan.mockResolvedValue(readyPlan());
  mockGetVersion.mockResolvedValue(sourceVersion());
  // Newest first — ver-7 is current, ver-3 is restorable history.
  mockListVersions.mockResolvedValue([
    { ...sourceVersion({ versionId: 'ver-7', versionNumber: 7 }) },
    sourceVersion(),
  ]);
  mockCopyS3Object.mockResolvedValue(undefined);
  mockRestoreContent.mockResolvedValue(readyPlan({ version: 8 }));
  mockCapture.mockResolvedValue(capturedRecord);
});

afterEach(() => {
  infoSpy.mockRestore();
});

describe('restoreSolutionPlanVersion — happy path', () => {
  it('runs the pipeline in order: copy → conditional write → capture (BR3.2)', async () => {
    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result.outcome).toBe('RESTORED');
    expect(mockCopyS3Object).toHaveBeenCalledTimes(1);
    expect(mockRestoreContent).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCopyS3Object.mock.invocationCallOrder[0]).toBeLessThan(
      mockRestoreContent.mock.invocationCallOrder[0],
    );
    expect(mockRestoreContent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCapture.mock.invocationCallOrder[0],
    );
  });

  it('copies server-side from the RECORD’s own key to a server-generated v{n+1} key — never client input, never the source key (BR1.1, NFR3.11)', async () => {
    await restoreSolutionPlanVersion(restoreInput);

    const [, copySource, copyDestination] = mockCopyS3Object.mock.calls[0];
    expect(copySource).toBe(sourceVersion().htmlContentKey);
    // Plan counter is 7 → the fresh copy lands under v8, the next version.
    expect(copyDestination).toBe('org-1/proj-1/opp-1/solution-plan/v8/solution-plan.html');
    expect(copyDestination).not.toBe(copySource);
    // Nothing from the request body appears in the key beyond the scoped triple.
    expect(copyDestination).not.toContain('ver-3');
  });

  it('writes the plan via C4 with the fresh key, the snapshot cost schedule, and the server-derived restorer', async () => {
    const costScheduleSnapshot = { currency: 'USD', items: [], oneTimeTotal: 0, ongoingAnnualTotal: 0 };
    mockGetVersion.mockResolvedValue(sourceVersion({ costScheduleSnapshot }));

    await restoreSolutionPlanVersion(restoreInput);

    expect(mockRestoreContent).toHaveBeenCalledWith({
      key,
      htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v8/solution-plan.html',
      costSchedule: costScheduleSnapshot,
      restoredBy: 'user-1',
    });
  });

  it('captures the restore version with origin "restore" and the caller identity — never the SYSTEM sentinel (BR3.1, NFR3.12)', async () => {
    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(mockCapture).toHaveBeenCalledWith({
      key,
      solutionPlanId: 'plan-1',
      versionNumber: 8, // the counter AFTER C4's server-side bump
      htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v8/solution-plan.html',
      costScheduleSnapshot: null,
      origin: 'restore',
      createdBy: 'user-1',
      createdByName: 'Alice Example',
    });
    expect(result).toEqual({
      outcome: 'RESTORED',
      newVersion: {
        versionId: 'ver-new',
        versionNumber: 8,
        origin: 'restore',
        createdBy: 'user-1',
        createdByName: 'Alice Example',
        createdAt: expect.any(String),
      },
    });
  });

  it('emits the solution_plan_restore_completed INFO event with all audit fields (NFR1.21)', async () => {
    await restoreSolutionPlanVersion(restoreInput);

    const completion = infoSpy.mock.calls
      .map(([line]) => JSON.parse(line as string))
      .find((entry) => entry.event === 'solution_plan_restore_completed');
    expect(completion).toMatchObject({
      ...key,
      sourceVersionId: 'ver-3',
      sourceVersionNumber: 3,
      newVersionId: 'ver-new',
      restoredBy: 'user-1',
      latencyMs: expect.any(Number),
      requestId: 'req-abc',
    });
  });
});

describe('restoreSolutionPlanVersion — guards (no side effects)', () => {
  it('returns SOURCE_NOT_FOUND when the source version vanished — nothing copied or written (BR2.3)', async () => {
    mockGetVersion.mockResolvedValue(null);

    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result).toEqual({ outcome: 'SOURCE_NOT_FOUND' });
    expect(mockCopyS3Object).not.toHaveBeenCalled();
    expect(mockRestoreContent).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('returns SOURCE_NOT_FOUND when the plan itself is missing', async () => {
    mockGetPlan.mockResolvedValue(null);

    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result).toEqual({ outcome: 'SOURCE_NOT_FOUND' });
    expect(mockCopyS3Object).not.toHaveBeenCalled();
    expect(mockRestoreContent).not.toHaveBeenCalled();
  });

  it('returns CURRENT_VERSION when the source is the newest history record — no copy paid for (BR2.1)', async () => {
    mockListVersions.mockResolvedValue([sourceVersion()]); // ver-3 IS newest

    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result).toEqual({ outcome: 'CURRENT_VERSION' });
    expect(mockCopyS3Object).not.toHaveBeenCalled();
    expect(mockRestoreContent).not.toHaveBeenCalled();
  });

  it('returns GENERATING on the mid-generation pre-check — no copy paid for (BR2.2)', async () => {
    mockGetPlan.mockResolvedValue(readyPlan({ status: 'GENERATING_SOT' }));

    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result).toEqual({ outcome: 'GENERATING' });
    expect(mockCopyS3Object).not.toHaveBeenCalled();
    expect(mockRestoreContent).not.toHaveBeenCalled();
  });

  it('proceeds on a FAILED plan — the core recovery scenario (BR2.2)', async () => {
    mockGetPlan.mockResolvedValue(readyPlan({ status: 'FAILED' }));

    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result.outcome).toBe('RESTORED');
    expect(mockRestoreContent).toHaveBeenCalledTimes(1);
  });
});

describe('restoreSolutionPlanVersion — failure-mode ledger', () => {
  it('classifies a C4 conditional failure AFTER the copy as GENERATING — plan untouched, orphaned copy accepted (NFR1.19, NFR1.17)', async () => {
    mockRestoreContent.mockRejectedValue(conditionalError());

    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result).toEqual({ outcome: 'GENERATING' });
    expect(mockCopyS3Object).toHaveBeenCalledTimes(1); // the accepted orphan
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('propagates a non-conditional C4 write error unchanged — plan untouched, no capture', async () => {
    mockRestoreContent.mockRejectedValue(new Error('DynamoDB unavailable'));

    await expect(restoreSolutionPlanVersion(restoreInput)).rejects.toThrow(
      'DynamoDB unavailable',
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('propagates an S3 copy failure — the plan write never happens (BR3.2)', async () => {
    mockCopyS3Object.mockRejectedValue(new Error('CopyObject failed'));

    await expect(restoreSolutionPlanVersion(restoreInput)).rejects.toThrow('CopyObject failed');
    expect(mockRestoreContent).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('capture fail-open: the restore still succeeds with newVersion null and the event carries newVersionId null (u1 BR5.1)', async () => {
    mockCapture.mockResolvedValue(null); // u1's fail-open no-record outcome

    const result = await restoreSolutionPlanVersion(restoreInput);

    expect(result).toEqual({ outcome: 'RESTORED', newVersion: null });
    const completion = infoSpy.mock.calls
      .map(([line]) => JSON.parse(line as string))
      .find((entry) => entry.event === 'solution_plan_restore_completed');
    expect(completion).toMatchObject({ newVersionId: null, restoredBy: 'user-1' });
  });
});
