/**
 * Tests for the Solution Plan version-history storage helpers (u1, contract C3).
 *
 * Mocks the DynamoDB document client at the SDK level (shared mockSend) so the
 * real `@/helpers/db` layer builds the actual TableName / key / condition
 * strings we assert on. S3 is mocked at the storage-helper module; Sentry is
 * mocked to verify the EXPLICIT captureException call on the fail-open path.
 */
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  PutCommand: jest.fn((input) => ({ commandName: 'PutCommand', input })),
  GetCommand: jest.fn((input) => ({ commandName: 'GetCommand', input })),
  QueryCommand: jest.fn((input) => ({ commandName: 'QueryCommand', input })),
  DeleteCommand: jest.fn((input) => ({ commandName: 'DeleteCommand', input })),
  UpdateCommand: jest.fn((input) => ({ commandName: 'UpdateCommand', input })),
  BatchWriteCommand: jest.fn((input) => ({ commandName: 'BatchWriteCommand', input })),
  ScanCommand: jest.fn((input) => ({ commandName: 'ScanCommand', input })),
}));

const mockDeleteS3Object = jest.fn();
jest.mock('@/helpers/s3', () => ({
  deleteS3Object: (...a: unknown[]) => mockDeleteS3Object(...a),
}));

const mockCaptureException = jest.fn();
jest.mock('@/sentry-lambda', () => ({
  Sentry: { captureException: (...a: unknown[]) => mockCaptureException(...a) },
  withSentryLambda: (handler: unknown) => handler,
}));

import { SYSTEM_CREATED_BY, SYSTEM_CREATED_BY_NAME } from '@auto-rfp/core';
import type { SolutionPlanKey } from '@auto-rfp/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import {
  SOLUTION_PLAN_VERSION_KEEP_COUNT,
  SOLUTION_PLAN_VERSION_PK,
} from '@/constants/solution-plan';
import {
  buildSolutionPlanVersionSk,
  buildSolutionPlanVersionSkPrefix,
  captureSolutionPlanVersion,
  deleteSolutionPlanVersion,
  getSolutionPlanVersion,
  listSolutionPlanVersions,
  padSolutionPlanVersionNumber,
  setSolutionPlanVersionLabel,
  toSolutionPlanVersionListItem,
} from './solution-plan-version';

const key: SolutionPlanKey = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const captureInput = {
  key,
  solutionPlanId: 'plan-1',
  versionNumber: 3,
  htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v3/solution-plan.html',
  origin: 'manual-save' as const,
  createdBy: 'user-1',
  createdByName: 'Alice Example',
};

/** A stored version row as the query mock returns it. */
const versionRow = (versionNumber: number, overrides: Record<string, unknown> = {}) => ({
  [PK_NAME]: SOLUTION_PLAN_VERSION_PK,
  [SK_NAME]: buildSolutionPlanVersionSk(key, versionNumber),
  versionId: `ver-${versionNumber}`,
  versionNumber,
  ...key,
  solutionPlanId: 'plan-1',
  htmlContentKey: `org-1/proj-1/opp-1/solution-plan/v${versionNumber}/solution-plan.html`,
  origin: 'generation',
  createdBy: 'user-1',
  createdByName: 'Alice Example',
  createdAt: '2026-08-28T00:00:00.000Z',
  ...overrides,
});

const conditionalError = () => {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
};

/** All mockSend calls of one command type, in call order. */
const sentCommands = (commandName: string) =>
  mockSend.mock.calls
    .map(([cmd]) => cmd as { commandName: string; input: Record<string, any> })
    .filter((cmd) => cmd.commandName === commandName);

let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteS3Object.mockResolvedValue({ key: 'k', success: true });
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  logSpy.mockRestore();
});

/** Default storage behavior: inserts succeed, the partition holds `rows`. */
const primeStorage = (rows: ReturnType<typeof versionRow>[]) => {
  mockSend.mockImplementation((cmd: { commandName: string }) => {
    if (cmd.commandName === 'QueryCommand') return Promise.resolve({ Items: rows });
    return Promise.resolve({});
  });
};

// ─── SK builders ────────────────────────────────────────────────────────────────

describe('SK builders', () => {
  it('zero-pads version numbers to 6 digits', () => {
    expect(padSolutionPlanVersionNumber(3)).toBe('000003');
    expect(padSolutionPlanVersionNumber(123456)).toBe('123456');
  });

  it('builds the scoped SK with the padded counter tail', () => {
    expect(buildSolutionPlanVersionSk(key, 3)).toBe('org-1#proj-1#opp-1#000003');
  });

  it('SKs sort numerically thanks to the padding', () => {
    expect(buildSolutionPlanVersionSk(key, 2) < buildSolutionPlanVersionSk(key, 10)).toBe(true);
  });

  it('builds the plan-scoped prefix', () => {
    expect(buildSolutionPlanVersionSkPrefix(key)).toBe('org-1#proj-1#opp-1#');
  });
});

// ─── captureSolutionPlanVersion ─────────────────────────────────────────────────

describe('captureSolutionPlanVersion', () => {
  it('inserts create-only with the exact table, keys, and condition (BR5.2)', async () => {
    primeStorage([versionRow(3)]);

    await captureSolutionPlanVersion(captureInput);

    const [put] = sentCommands('PutCommand');
    expect(put.input.TableName).toBe('test-table');
    expect(put.input.ConditionExpression).toBe(
      'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
    );
    expect(put.input.Item).toMatchObject({
      [PK_NAME]: SOLUTION_PLAN_VERSION_PK,
      [SK_NAME]: 'org-1#proj-1#opp-1#000003',
      versionId: expect.any(String),
      versionNumber: 3,
      ...key,
      solutionPlanId: 'plan-1',
      htmlContentKey: captureInput.htmlContentKey,
      origin: 'manual-save',
      createdBy: 'user-1',
      createdByName: 'Alice Example',
      createdAt: expect.any(String),
    });
    // Manual saves clear the cost schedule — no snapshot attribute at all
    expect(put.input.Item).not.toHaveProperty('costScheduleSnapshot');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('stores the costScheduleSnapshot when the captured write carried one (BR2.1)', async () => {
    primeStorage([versionRow(3)]);
    const costScheduleSnapshot = {
      currency: 'USD',
      items: [
        { label: 'Hosting', category: 'LABOR' as const, amount: 400, billing: 'MONTHLY' as const, optional: false },
      ],
      oneTimeTotal: 0,
      ongoingAnnualTotal: 4800,
    };

    await captureSolutionPlanVersion({ ...captureInput, origin: 'generation', costScheduleSnapshot });

    expect(sentCommands('PutCommand')[0].input.Item.costScheduleSnapshot).toEqual(
      costScheduleSnapshot,
    );
  });

  it('treats a duplicate insert as a silent no-op success — no prune, no log, no Sentry (BR5.2)', async () => {
    mockSend.mockImplementation((cmd: { commandName: string }) => {
      if (cmd.commandName === 'PutCommand') return Promise.reject(conditionalError());
      return Promise.resolve({ Items: [] });
    });

    // No record created by THIS call — the returned record is null (BR5.2)
    await expect(captureSolutionPlanVersion(captureInput)).resolves.toBeNull();

    expect(sentCommands('QueryCommand')).toHaveLength(0); // no prune pass
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prunes the OLDEST record and its own body when the cap is exceeded (BR4.1/BR4.2)', async () => {
    const rows = Array.from({ length: SOLUTION_PLAN_VERSION_KEEP_COUNT + 1 }, (_, i) =>
      versionRow(i + 1),
    );
    primeStorage(rows);

    await captureSolutionPlanVersion({ ...captureInput, versionNumber: 31 });

    // Slim projection on the retention query (performance design)
    const [query] = sentCommands('QueryCommand');
    expect(query.input.ProjectionExpression).toBe('#sk, htmlContentKey');

    const deletes = sentCommands('DeleteCommand');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input).toMatchObject({
      TableName: 'test-table',
      Key: { [PK_NAME]: SOLUTION_PLAN_VERSION_PK, [SK_NAME]: 'org-1#proj-1#opp-1#000001' },
    });
    // Record FIRST, then its body — and the body is the pruned record's OWN key
    expect(mockDeleteS3Object).toHaveBeenCalledWith(
      'test-bucket',
      'org-1/proj-1/opp-1/solution-plan/v1/solution-plan.html',
    );
    expect(mockDeleteS3Object.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSend.mock.invocationCallOrder[mockSend.mock.calls.findIndex(([c]) => (c as { commandName: string }).commandName === 'DeleteCommand')],
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"solution_plan_version_pruned"'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"removedCount":1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"remainingCount":30'));
  });

  it('heals a transient 31 by removing as many oldest as needed (self-healing prune)', async () => {
    // 32 records at loop start = a previously failed prune left one extra
    const rows = Array.from({ length: SOLUTION_PLAN_VERSION_KEEP_COUNT + 2 }, (_, i) =>
      versionRow(i + 1),
    );
    primeStorage(rows);

    await captureSolutionPlanVersion({ ...captureInput, versionNumber: 32 });

    const deletedSks = sentCommands('DeleteCommand').map((cmd) => cmd.input.Key[SK_NAME]);
    expect(deletedSks).toEqual(['org-1#proj-1#opp-1#000001', 'org-1#proj-1#opp-1#000002']);
    // The newest record is structurally exempt (BR4.3)
    expect(deletedSks).not.toContain(buildSolutionPlanVersionSk(key, 32));
  });

  it('still succeeds when the prune fails after a committed insert (transient 31, BR4.1)', async () => {
    mockSend.mockImplementation((cmd: { commandName: string }) => {
      if (cmd.commandName === 'QueryCommand') return Promise.reject(new Error('query broke'));
      return Promise.resolve({});
    });

    // The committed insert still surfaces as the created record (fail-open)
    await expect(captureSolutionPlanVersion(captureInput)).resolves.toMatchObject({
      versionNumber: captureInput.versionNumber,
      origin: captureInput.origin,
    });

    expect(sentCommands('PutCommand')).toHaveLength(1); // insert committed
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('is fail-open: a storage error is logged + Sentry-reported explicitly, never thrown (BR5.1/NFR1.6)', async () => {
    const boom = new Error('DynamoDB unavailable');
    mockSend.mockRejectedValue(boom);

    // Failed before the insert committed — no record to return (fail-open null)
    await expect(captureSolutionPlanVersion(captureInput)).resolves.toBeNull();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"solution_plan_version_capture_failed"'),
    );
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      ...key,
      origin: 'manual-save',
      versionNumber: 3,
      failureReason: 'Error: DynamoDB unavailable',
    });
    expect(mockCaptureException).toHaveBeenCalledWith(boom, {
      tags: { feature: 'solution-plan-versioning', origin: 'manual-save' },
    });
  });

  it('falls back to the imported system sentinel with a warning when attribution is absent (BR3.3)', async () => {
    primeStorage([versionRow(3)]);

    await captureSolutionPlanVersion({
      ...captureInput,
      origin: 'generation',
      createdBy: undefined,
      createdByName: undefined,
    });

    expect(sentCommands('PutCommand')[0].input.Item).toMatchObject({
      createdBy: SYSTEM_CREATED_BY,
      createdByName: SYSTEM_CREATED_BY_NAME,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"solution_plan_version_missing_initiator_stamp"'),
    );
    // Expected condition — never Sentry-reported (NFR1.7)
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

// ─── listSolutionPlanVersions / getSolutionPlanVersion ──────────────────────────

describe('listSolutionPlanVersions', () => {
  it('returns newest first, capped at 30, with DB keys stripped', async () => {
    const rows = Array.from({ length: 31 }, (_, i) => versionRow(i + 1));
    primeStorage(rows);

    const versions = await listSolutionPlanVersions(key);

    expect(versions).toHaveLength(SOLUTION_PLAN_VERSION_KEEP_COUNT);
    expect(versions[0].versionNumber).toBe(31);
    expect(versions[29].versionNumber).toBe(2); // the transient oldest is never served
    expect(versions[0]).not.toHaveProperty(PK_NAME);
    expect(versions[0]).not.toHaveProperty(SK_NAME);

    const [query] = sentCommands('QueryCommand');
    expect(query.input.TableName).toBe('test-table');
    expect(query.input.ExpressionAttributeValues).toMatchObject({
      ':pk': SOLUTION_PLAN_VERSION_PK,
      ':skPrefix': 'org-1#proj-1#opp-1#',
    });
  });

  it('returns an empty array for a plan with no history', async () => {
    primeStorage([]);
    await expect(listSolutionPlanVersions(key)).resolves.toEqual([]);
  });
});

describe('getSolutionPlanVersion', () => {
  it('finds a version by versionId within the plan scope', async () => {
    primeStorage([versionRow(1), versionRow(2)]);

    const version = await getSolutionPlanVersion(key, 'ver-2');

    expect(version).toMatchObject({ versionId: 'ver-2', versionNumber: 2 });
    expect(version).not.toHaveProperty(SK_NAME);
  });

  it('returns null when the version no longer exists (404 semantics)', async () => {
    primeStorage([versionRow(1)]);
    await expect(getSolutionPlanVersion(key, 'ver-9')).resolves.toBeNull();
  });
});

// ─── setSolutionPlanVersionLabel ────────────────────────────────────────────────

describe('setSolutionPlanVersionLabel', () => {
  it('SETs the label with an attribute_exists condition on the record key', async () => {
    mockSend.mockImplementation((cmd: { commandName: string }) => {
      if (cmd.commandName === 'QueryCommand')
        return Promise.resolve({ Items: [versionRow(1), versionRow(2)] });
      return Promise.resolve({ Attributes: versionRow(2, { label: 'Pre-pricing review' }) });
    });

    const updated = await setSolutionPlanVersionLabel(key, 'ver-2', 'Pre-pricing review');

    const [update] = sentCommands('UpdateCommand');
    expect(update.input).toMatchObject({
      TableName: 'test-table',
      Key: { [PK_NAME]: SOLUTION_PLAN_VERSION_PK, [SK_NAME]: 'org-1#proj-1#opp-1#000002' },
      UpdateExpression: 'SET #attr = :value, #updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
    });
    expect(update.input.ExpressionAttributeNames['#attr']).toBe('label');
    expect(update.input.ExpressionAttributeValues[':value']).toBe('Pre-pricing review');
    expect(updated).toMatchObject({ versionId: 'ver-2', label: 'Pre-pricing review' });
  });

  it('REMOVEs the label when the new value is empty/whitespace', async () => {
    mockSend.mockImplementation((cmd: { commandName: string }) => {
      if (cmd.commandName === 'QueryCommand') return Promise.resolve({ Items: [versionRow(2)] });
      return Promise.resolve({ Attributes: versionRow(2) });
    });

    await setSolutionPlanVersionLabel(key, 'ver-2', '   ');

    const [update] = sentCommands('UpdateCommand');
    expect(update.input.UpdateExpression).toBe('REMOVE #attr SET #updatedAt = :updatedAt');
    expect(update.input.ExpressionAttributeValues).toEqual({ ':updatedAt': expect.any(String) });
  });

  it('returns null when the version is not in the plan scope (404, no write issued)', async () => {
    primeStorage([versionRow(1)]);

    await expect(setSolutionPlanVersionLabel(key, 'ver-9', 'x')).resolves.toBeNull();
    expect(sentCommands('UpdateCommand')).toHaveLength(0);
  });

  it('returns null when the record vanished between locate and write (condition miss)', async () => {
    mockSend.mockImplementation((cmd: { commandName: string }) => {
      if (cmd.commandName === 'QueryCommand') return Promise.resolve({ Items: [versionRow(2)] });
      return Promise.reject(conditionalError());
    });

    await expect(setSolutionPlanVersionLabel(key, 'ver-2', 'x')).resolves.toBeNull();
  });
});

// ─── deleteSolutionPlanVersion ──────────────────────────────────────────────────

describe('deleteSolutionPlanVersion', () => {
  it('deletes the record first, then its own body (missing body tolerated)', async () => {
    primeStorage([versionRow(1), versionRow(2)]);
    // Simulate an already-missing body — best-effort delete reports, never throws
    mockDeleteS3Object.mockResolvedValue({ key: 'k', success: false, error: 'NoSuchKey' });

    const result = await deleteSolutionPlanVersion(key, 'ver-1');

    expect(result).toEqual({ outcome: 'DELETED' });
    const deletes = sentCommands('DeleteCommand');
    expect(deletes[0].input.Key).toEqual({
      [PK_NAME]: SOLUTION_PLAN_VERSION_PK,
      [SK_NAME]: 'org-1#proj-1#opp-1#000001',
    });
    expect(mockDeleteS3Object).toHaveBeenCalledWith(
      'test-bucket',
      'org-1/proj-1/opp-1/solution-plan/v1/solution-plan.html',
    );
  });

  it('refuses to delete the newest (current) version', async () => {
    primeStorage([versionRow(1), versionRow(2)]);

    const result = await deleteSolutionPlanVersion(key, 'ver-2');

    expect(result).toEqual({ outcome: 'REFUSED_CURRENT' });
    expect(sentCommands('DeleteCommand')).toHaveLength(0);
    expect(mockDeleteS3Object).not.toHaveBeenCalled();
  });

  it('reports NOT_FOUND for an unknown or already-deleted versionId', async () => {
    primeStorage([versionRow(1)]);
    await expect(deleteSolutionPlanVersion(key, 'ver-9')).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });
  });
});

describe('toSolutionPlanVersionListItem (u2 C1 list projection)', () => {
  const fullItem = {
    versionId: 'ver-2',
    versionNumber: 2,
    ...key,
    solutionPlanId: 'plan-1',
    htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
    origin: 'manual-save' as const,
    label: 'Reviewed draft',
    createdBy: 'user-1',
    createdByName: 'Alice Example',
    createdAt: '2026-08-28T00:00:00.000Z',
  };

  it('projects to the C1 list shape and strips storage-only fields (htmlContentKey never leaves)', () => {
    expect(toSolutionPlanVersionListItem(fullItem)).toEqual({
      versionId: 'ver-2',
      versionNumber: 2,
      origin: 'manual-save',
      label: 'Reviewed draft',
      createdBy: 'user-1',
      createdByName: 'Alice Example',
      createdAt: expect.any(String),
    });
  });

  it('omits the label key entirely when the version has none', () => {
    const { label: _label, ...unlabeled } = fullItem;
    const projected = toSolutionPlanVersionListItem(unlabeled);
    expect('label' in projected).toBe(false);
  });

  it('keeps the SYSTEM attribution sentinel verbatim', () => {
    const projected = toSolutionPlanVersionListItem({
      ...fullItem,
      createdBy: SYSTEM_CREATED_BY,
      createdByName: SYSTEM_CREATED_BY_NAME,
    });
    expect(projected.createdBy).toBe(SYSTEM_CREATED_BY);
    expect(projected.createdByName).toBe(SYSTEM_CREATED_BY_NAME);
  });
});
