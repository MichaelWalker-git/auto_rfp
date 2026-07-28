/**
 * Retention (Option B) tests for createReviewRun: TTL stamp + keep-N prune.
 * Mocks the db layer so we can assert what createItem/batchDeleteItems receive.
 */
const mockCreateItem = jest.fn();
const mockQueryBySkPrefix = jest.fn();
const mockBatchDeleteItems = jest.fn();

jest.mock('@/helpers/db', () => ({
  createItem: (...a: unknown[]) => mockCreateItem(...a),
  queryBySkPrefix: (...a: unknown[]) => mockQueryBySkPrefix(...a),
  batchDeleteItems: (...a: unknown[]) => mockBatchDeleteItems(...a),
  getItem: jest.fn(),
  putItem: jest.fn(),
  deleteAllBySkPrefix: jest.fn(),
  docClient: { send: jest.fn() },
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { createReviewRun } from './compliance-review';
import { RUN_KEEP_COUNT, RUN_TTL_DAYS } from '@/constants/compliance-review';
import type { ComplianceReviewRun } from '@auto-rfp/core';

const makeRun = (i: number, status: ComplianceReviewRun['status'] = 'READY'): ComplianceReviewRun => ({
  reviewId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  orgId: 'o',
  projectId: 'p',
  oppId: 'opp',
  status,
  trigger: 'FULL',
  // Older as i grows, so index 0 is newest after sort.
  startedAt: new Date(2026, 0, 1, 0, 0, 100 - i).toISOString(),
  snapshotVersionIds: {},
  findings: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateItem.mockImplementation((_pk, _sk, item) => Promise.resolve(item));
  mockBatchDeleteItems.mockResolvedValue({ deleted: 0, failed: 0 });
});

describe('createReviewRun retention', () => {
  it('returns null when an active RUNNING run exists (409 guard)', async () => {
    // Must be recent, or isRunActive treats it as a stale (crashed) run.
    const activeRun = { ...makeRun(1, 'RUNNING'), startedAt: new Date().toISOString() };
    mockQueryBySkPrefix.mockResolvedValue([activeRun]);
    const result = await createReviewRun({
      orgId: 'o', projectId: 'p', oppId: 'opp', trigger: 'FULL', snapshotVersionIds: {},
    });
    expect(result).toBeNull();
    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('stamps a ttl ~RUN_TTL_DAYS in the future', async () => {
    mockQueryBySkPrefix.mockResolvedValue([]);
    await createReviewRun({ orgId: 'o', projectId: 'p', oppId: 'opp', trigger: 'FULL', snapshotVersionIds: {} });
    const item = mockCreateItem.mock.calls[0][2];
    const expected = Math.floor(Date.now() / 1000) + RUN_TTL_DAYS * 86400;
    expect(item.ttl).toBeGreaterThan(expected - 60);
    expect(item.ttl).toBeLessThanOrEqual(expected + 60);
  });

  it('does not prune when under the keep count', async () => {
    mockQueryBySkPrefix.mockResolvedValue([makeRun(1), makeRun(2)]);
    await createReviewRun({ orgId: 'o', projectId: 'p', oppId: 'opp', trigger: 'FULL', snapshotVersionIds: {} });
    expect(mockBatchDeleteItems).not.toHaveBeenCalled();
  });

  it('prunes the oldest runs beyond keep count (new run counts as #1)', async () => {
    // Existing = RUN_KEEP_COUNT runs; adding one makes KEEP_COUNT+1, so exactly
    // one (the oldest) should be pruned.
    const existing = Array.from({ length: RUN_KEEP_COUNT }, (_, i) => makeRun(i + 1));
    mockQueryBySkPrefix.mockResolvedValue(existing);
    await createReviewRun({ orgId: 'o', projectId: 'p', oppId: 'opp', trigger: 'FULL', snapshotVersionIds: {} });
    expect(mockBatchDeleteItems).toHaveBeenCalledTimes(1);
    const pruned = mockBatchDeleteItems.mock.calls[0][0] as Array<{ sk: string }>;
    expect(pruned).toHaveLength(1);
    // The pruned run is the oldest (last after newest-first sort).
    expect(pruned[0].sk).toContain(existing[existing.length - 1].reviewId);
  });

  it('does not block the run if pruning fails', async () => {
    const existing = Array.from({ length: RUN_KEEP_COUNT + 3 }, (_, i) => makeRun(i + 1));
    mockQueryBySkPrefix.mockResolvedValue(existing);
    mockBatchDeleteItems.mockRejectedValue(new Error('boom'));
    const result = await createReviewRun({
      orgId: 'o', projectId: 'p', oppId: 'opp', trigger: 'FULL', snapshotVersionIds: {},
    });
    expect(result).not.toBeNull();
    expect(result?.status).toBe('RUNNING');
  });
});
