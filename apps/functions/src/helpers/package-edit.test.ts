import fc from 'fast-check';

// ── Mock db before importing the module under test ────────────────────────────
const mockCreateItem = jest.fn();
const mockPutItem = jest.fn();
const mockQueryBySkPrefix = jest.fn();
const mockBatchDeleteItems = jest.fn();
const mockDeleteItemIf = jest.fn();
const mockAppendToList = jest.fn();
jest.mock('@/helpers/db', () => ({
  createItem: (...a: unknown[]) => mockCreateItem(...a),
  putItem: (...a: unknown[]) => mockPutItem(...a),
  queryBySkPrefix: (...a: unknown[]) => mockQueryBySkPrefix(...a),
  batchDeleteItems: (...a: unknown[]) => mockBatchDeleteItems(...a),
  deleteItemIf: (...a: unknown[]) => mockDeleteItemIf(...a),
  appendToList: (...a: unknown[]) => mockAppendToList(...a),
  // Real predicate so the lock's acquire/release recognises the conflict error.
  isConditionalCheckFailed: (err: unknown) =>
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ConditionalCheckFailedException',
}));

const LOCK_PK = 'PACKAGE_EDIT_RUN_LOCK';
const conflictError = () =>
  Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

import type { PackageEditRun } from '@auto-rfp/core';
import {
  buildPackageEditRunSk,
  buildPackageEditRunPrefix,
  isRunActive,
  isRunStale,
  createProposalRun,
  getLatestProposalRun,
  getProposalRunById,
  markRunProposed,
  markRunFailed,
  markEditsApplied,
  type PackageEditRunItem,
} from './package-edit';
import { RUN_STALE_TIMEOUT_MS } from '@/constants/package-edit';

const PACKAGE_EDIT_RUN_PK = 'PACKAGE_EDIT_RUN';

const makeRun = (over: Partial<PackageEditRunItem> = {}): PackageEditRunItem => ({
  runId: 'r1',
  orgId: 'o',
  projectId: 'p',
  oppId: 'opp',
  status: 'PROPOSING',
  instruction: 'make it $2.4M everywhere',
  proposals: [],
  snapshotVersionIds: {},
  startedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchDeleteItems.mockResolvedValue({ deleted: 0, failed: 0 });
  mockDeleteItemIf.mockResolvedValue(true);
});

describe('SK builders', () => {
  it('builds the opp-scoped run SK with startedAt#runId', () => {
    expect(buildPackageEditRunSk('o', 'p', 'opp', '2026-01-01T00:00:00.000Z', 'r1')).toBe(
      'o#p#opp#2026-01-01T00:00:00.000Z#r1',
    );
  });

  it('prefix is a prefix of the full SK', () => {
    const prefix = buildPackageEditRunPrefix('o', 'p', 'opp');
    const sk = buildPackageEditRunSk('o', 'p', 'opp', '2026-01-01T00:00:00.000Z', 'r1');
    expect(sk.startsWith(prefix)).toBe(true);
  });
});

describe('staleness', () => {
  it('a fresh PROPOSING run is active, not stale', () => {
    const run = makeRun({ startedAt: new Date().toISOString() });
    expect(isRunActive(run)).toBe(true);
    expect(isRunStale(run)).toBe(false);
  });

  it('a PROPOSING run past the timeout is stale, not active', () => {
    const old = new Date(Date.now() - RUN_STALE_TIMEOUT_MS - 1000).toISOString();
    const run = makeRun({ startedAt: old });
    expect(isRunActive(run)).toBe(false);
    expect(isRunStale(run)).toBe(true);
  });

  it('a PROPOSED run is neither active nor stale', () => {
    const run = makeRun({ status: 'PROPOSED' });
    expect(isRunActive(run)).toBe(false);
    expect(isRunStale(run)).toBe(false);
  });
});

describe('createProposalRun (atomic lock guard)', () => {
  it('returns null (no run row, no scan) when the active-run lock is held', async () => {
    // Lock acquisition is a conditional createItem on the LOCK pk; a held lock →
    // ConditionalCheckFailedException → null. The run row must never be written.
    mockCreateItem.mockImplementationOnce(async (pk) => {
      if (pk === LOCK_PK) throw conflictError();
      return {};
    });

    const result = await createProposalRun({
      orgId: 'o', projectId: 'p', oppId: 'opp', instruction: 'x', snapshotVersionIds: {},
    });

    expect(result).toBeNull();
    // Only the lock create was attempted — no run row.
    const runWrites = mockCreateItem.mock.calls.filter(([pk]) => pk === PACKAGE_EDIT_RUN_PK);
    expect(runWrites).toHaveLength(0);
    expect(mockDeleteItemIf).not.toHaveBeenCalled(); // nothing to release
  });

  it('acquires the lock and writes a PROPOSING run when the slot is free', async () => {
    // Lock create succeeds, run create succeeds, prune list returns just the new run.
    mockCreateItem.mockImplementation(async (_pk, _sk, item) => item);
    mockQueryBySkPrefix.mockResolvedValueOnce([]); // post-write prune list

    const result = await createProposalRun({
      orgId: 'o', projectId: 'p', oppId: 'opp', instruction: 'do it', snapshotVersionIds: { 'doc:1': 't' },
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('PROPOSING');
    expect(result?.instruction).toBe('do it');
    // First create is the lock, second is the run row.
    expect(mockCreateItem.mock.calls[0][0]).toBe(LOCK_PK);
    expect(mockCreateItem.mock.calls[1][0]).toBe(PACKAGE_EDIT_RUN_PK);
  });

  it('releases the lock and rethrows if the run-row write fails after acquiring', async () => {
    mockCreateItem.mockImplementation(async (pk) => {
      if (pk === LOCK_PK) return {}; // lock acquired
      throw new Error('run write boom'); // run row fails
    });

    await expect(
      createProposalRun({ orgId: 'o', projectId: 'p', oppId: 'opp', instruction: 'x', snapshotVersionIds: {} }),
    ).rejects.toThrow('run write boom');
    // The lock we took must be freed so the opportunity isn't wedged.
    expect(mockDeleteItemIf).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemIf.mock.calls[0][0]).toBe(LOCK_PK);
  });
});

describe('getLatestProposalRun / getProposalRunById', () => {
  it('returns newest run first', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([
      makeRun({ runId: 'a', startedAt: '2026-01-01T00:00:00.000Z' }),
      makeRun({ runId: 'b', startedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    const latest = await getLatestProposalRun('o', 'p', 'opp');
    expect(latest?.runId).toBe('b');
  });

  it('finds a run by id', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([makeRun({ runId: 'a' }), makeRun({ runId: 'b' })]);
    const run = await getProposalRunById('o', 'p', 'opp', 'a');
    expect(run?.runId).toBe('a');
  });

  it('returns null for an unknown id', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([makeRun({ runId: 'a' })]);
    expect(await getProposalRunById('o', 'p', 'opp', 'zzz')).toBeNull();
  });
});

describe('markRunProposed / markRunFailed', () => {
  it('marks PROPOSED with proposals + finishedAt', async () => {
    mockPutItem.mockResolvedValueOnce({});
    const run = makeRun();
    const proposals = [
      {
        editId: 'e1',
        target: { kind: 'FORM' as const, formId: 'f', fieldId: 'fl' },
        before: 'a',
        after: 'b',
        rationale: 'r',
        advisoryOnly: false,
      },
    ];
    const updated = await markRunProposed(run, proposals);
    expect(updated.status).toBe('PROPOSED');
    expect(updated.proposals).toEqual(proposals);
    expect(updated.finishedAt).toEqual(expect.any(String));
    // Terminal transition frees the active-run lock (guarded on this runId).
    expect(mockDeleteItemIf).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemIf.mock.calls[0][0]).toBe(LOCK_PK);
    expect(mockDeleteItemIf.mock.calls[0][4]).toEqual({ ':runId': run.runId });
  });

  it('marks FAILED with an error and releases the lock', async () => {
    mockPutItem.mockResolvedValueOnce({});
    const run = makeRun();
    const updated = await markRunFailed(run, 'boom');
    expect(updated.status).toBe('FAILED');
    expect(updated.error).toBe('boom');
    expect(mockDeleteItemIf).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemIf.mock.calls[0][0]).toBe(LOCK_PK);
    expect(mockDeleteItemIf.mock.calls[0][4]).toEqual({ ':runId': run.runId });
  });
});

describe('markEditsApplied', () => {
  it('atomically APPENDS only the new ids (not a full-item overwrite) and keeps status PROPOSED', async () => {
    // e1 is already known; e2/e3 are new. It must append just [e2, e3] via
    // list_append — never rewrite the whole run row (last-write-wins under races).
    mockAppendToList.mockResolvedValueOnce(
      makeRun({ status: 'PROPOSED', appliedEditIds: ['e1', 'e2', 'e3'] }),
    );
    const run = makeRun({ status: 'PROPOSED', appliedEditIds: ['e1'] });
    const updated = await markEditsApplied(run, ['e2', 'e1', 'e3']);

    expect(mockPutItem).not.toHaveBeenCalled(); // no full-item overwrite
    expect(mockAppendToList).toHaveBeenCalledTimes(1);
    const [pk, , attr, appended] = mockAppendToList.mock.calls[0];
    expect(pk).toBe(PACKAGE_EDIT_RUN_PK);
    expect(attr).toBe('appliedEditIds');
    expect(appended).toEqual(['e2', 'e3']); // e1 filtered as already known
    expect(updated.status).toBe('PROPOSED');
  });

  it('is a no-op (no write) when given an empty list', async () => {
    const run = makeRun({ appliedEditIds: ['e1'] });
    const updated = await markEditsApplied(run, []);
    expect(mockAppendToList).not.toHaveBeenCalled();
    expect(updated).toBe(run);
  });

  it('is a no-op when every id is already recorded (nothing new to append)', async () => {
    const run = makeRun({ status: 'PROPOSED', appliedEditIds: ['e1', 'e2'] });
    const updated = await markEditsApplied(run, ['e1', 'e2']);
    expect(mockAppendToList).not.toHaveBeenCalled();
    expect(updated).toBe(run);
  });
});

// ─── PBT (PBT-03 invariant) ─────────────────────────────────────────────────────
describe('PBT — run SK builder', () => {
  it('always yields "{o}#{p}#{opp}#{startedAt}#{runId}" and prefix is always a prefix', () => {
    const seg = fc.string({ minLength: 1 }).filter((s) => !s.includes('#'));
    fc.assert(
      fc.property(seg, seg, seg, seg, seg, (o, p, opp, started, runId) => {
        const sk = buildPackageEditRunSk(o, p, opp, started, runId);
        const prefix = buildPackageEditRunPrefix(o, p, opp);
        expect(sk).toBe(`${o}#${p}#${opp}#${started}#${runId}`);
        expect(sk.startsWith(prefix)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// Keep a reference to the imported type so unused-import lint stays quiet in strict builds.
export type _RunType = PackageEditRun;
