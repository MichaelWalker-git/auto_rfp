// ── Mock db + s3 + sibling helpers before importing the module under test ──────
const mockCreateItem = jest.fn();
const mockQueryAllBySkPrefix = jest.fn();
const mockGetItem = jest.fn();
const mockBatchDeleteItems = jest.fn();
jest.mock('@/helpers/db', () => ({
  createItem: (...a: unknown[]) => mockCreateItem(...a),
  queryAllBySkPrefix: (...a: unknown[]) => mockQueryAllBySkPrefix(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  batchDeleteItems: (...a: unknown[]) => mockBatchDeleteItems(...a),
  isConditionalCheckFailed: (err: unknown) =>
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ConditionalCheckFailedException',
}));

const mockCopy = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/helpers/s3', () => ({
  copyS3Object: (...a: unknown[]) => mockCopy(...a),
  deleteS3Object: (...a: unknown[]) => mockDelete(...a),
}));

const mockGetRFPDocument = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  getRFPDocument: (...a: unknown[]) => mockGetRFPDocument(...a),
}));

jest.mock('@/helpers/env', () => ({ requireEnv: (_k: string, d?: string) => d ?? 'test-bucket' }));

process.env.DOCUMENTS_BUCKET = 'test-bucket';

import {
  buildQuestionnaireVersionSk,
  buildQuestionnaireVersionPrefix,
  snapshotQuestionnaire,
  listQuestionnaireVersions,
  revertQuestionnaireToVersion,
} from './questionnaire-version';

const PK = 'QUESTIONNAIRE_VERSION';

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryAllBySkPrefix.mockResolvedValue([]);
  mockCreateItem.mockResolvedValue(undefined);
  mockBatchDeleteItems.mockResolvedValue({ deleted: 0, failed: 0 });
  mockCopy.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue({ key: 'k', success: true });
});

describe('SK builders', () => {
  it('zero-pads the version and joins the composite key', () => {
    expect(buildQuestionnaireVersionSk('o', 'p', 'opp', 'd', 3)).toBe('o#p#opp#d#000003');
    expect(buildQuestionnaireVersionPrefix('o', 'p', 'opp', 'd')).toBe('o#p#opp#d#');
  });
});

describe('snapshotQuestionnaire', () => {
  it('copies the live file to a version key then writes the version row (v1 from empty history)', async () => {
    const version = await snapshotQuestionnaire({
      orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd',
      currentFileKey: 'o/p/opp/rfp-documents/d/live.xlsx', source: 'AI_MASS_EDIT', userId: 'u1',
    });

    expect(version).toBe(1);
    // File copied to the versioned key BEFORE the row is written.
    expect(mockCopy).toHaveBeenCalledWith('test-bucket', 'o/p/opp/rfp-documents/d/live.xlsx', 'questionnaire-versions/d/v1.xlsx');
    expect(mockCreateItem).toHaveBeenCalledWith(
      PK,
      'o#p#opp#d#000001',
      expect.objectContaining({
        documentId: 'd',
        versionNumber: 1,
        snapshotFileKey: 'questionnaire-versions/d/v1.xlsx',
        source: 'AI_MASS_EDIT',
        createdBy: 'u1',
      }),
    );
  });

  it('increments the version number off the latest existing version', async () => {
    mockQueryAllBySkPrefix.mockResolvedValueOnce([
      { versionNumber: 2, snapshotFileKey: 'x' },
      { versionNumber: 1, snapshotFileKey: 'y' },
    ]);
    const version = await snapshotQuestionnaire({
      orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd',
      currentFileKey: 'o/p/opp/rfp-documents/d/live.xlsx', source: 'MANUAL',
    });
    expect(version).toBe(3);
  });

  it('recomputes the version + snapshot key and retries on a concurrent-write race (H1)', async () => {
    const conflict = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
    // Attempt 1: latest=2 → try v3 → collision.
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 2, snapshotFileKey: 'x' }]);
    mockCreateItem.mockRejectedValueOnce(conflict);
    // Attempt 2: latest now 3 → try v4 → succeeds.
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 3, snapshotFileKey: 'y' }]);
    mockCreateItem.mockResolvedValueOnce({});
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]); // prune

    const version = await snapshotQuestionnaire({
      orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd',
      currentFileKey: 'o/p/opp/rfp-documents/d/live.xlsx', source: 'MANUAL',
    });

    expect(version).toBe(4);
    expect(mockCreateItem).toHaveBeenCalledTimes(2);
    // The S3 copy target for the winning attempt is keyed by the recomputed version.
    expect(mockCopy).toHaveBeenLastCalledWith('test-bucket', 'o/p/opp/rfp-documents/d/live.xlsx', 'questionnaire-versions/d/v4.xlsx');
  });

  it('cleans up the copied snapshot object when the row write fails non-conditionally (H2)', async () => {
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 2, snapshotFileKey: 'x' }]);
    mockCreateItem.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalServerError' }));

    await expect(
      snapshotQuestionnaire({
        orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd',
        currentFileKey: 'o/p/opp/rfp-documents/d/live.xlsx', source: 'MANUAL',
      }),
    ).rejects.toThrow('boom');

    // The orphaned v3 copy is deleted; no retry (non-conditional).
    expect(mockCreateItem).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('test-bucket', 'questionnaire-versions/d/v3.xlsx');
  });

  it('does NOT delete the object on a conditional collision (a winner references it)', async () => {
    const conflict = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
    // Attempt 1 collides on v3, attempt 2 wins on v4.
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 2, snapshotFileKey: 'x' }]);
    mockCreateItem.mockRejectedValueOnce(conflict);
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 3, snapshotFileKey: 'y' }]);
    mockCreateItem.mockResolvedValueOnce({});
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]); // prune

    await snapshotQuestionnaire({
      orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd',
      currentFileKey: 'o/p/opp/rfp-documents/d/live.xlsx', source: 'MANUAL',
    });

    // v3 (the concurrent winner's object) must NOT be deleted by our loser attempt.
    expect(mockDelete).not.toHaveBeenCalledWith('test-bucket', 'questionnaire-versions/d/v3.xlsx');
  });

  it('does NOT fail the snapshot when prune throws after the row commits (best-effort)', async () => {
    // 40 existing (over the cap) so a prune is attempted; its batch delete throws.
    // The version row already committed, so the snapshot must still succeed —
    // otherwise a revert would abort with a misleading "could not snapshot".
    const existing = Array.from({ length: 40 }, (_, i) => ({
      versionNumber: 40 - i,
      snapshotFileKey: `questionnaire-versions/d/v${40 - i}.xlsx`,
    }));
    mockQueryAllBySkPrefix.mockResolvedValue(existing);
    mockBatchDeleteItems.mockRejectedValueOnce(new Error('dynamo throttled'));

    const version = await snapshotQuestionnaire({
      orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd',
      currentFileKey: 'o/p/opp/rfp-documents/d/live.xlsx', source: 'MANUAL',
    });

    expect(version).toBe(41); // committed despite the prune failure
    expect(mockBatchDeleteItems).toHaveBeenCalled();
  });

  it('prunes and deletes S3 objects beyond the keep count', async () => {
    // 31 existing versions → after adding one, the oldest is pruned.
    const existing = Array.from({ length: 31 }, (_, i) => ({
      versionNumber: 31 - i, // newest first
      snapshotFileKey: `questionnaire-versions/d/v${31 - i}.xlsx`,
    }));
    // First call (getLatest) + second call (prune list) both return the list.
    mockQueryAllBySkPrefix.mockResolvedValue(existing);

    await snapshotQuestionnaire({
      orgId: 'o', projectId: 'p', oppId: 'opp', documentId: 'd',
      currentFileKey: 'o/p/opp/rfp-documents/d/live.xlsx', source: 'MANUAL',
    });

    expect(mockBatchDeleteItems).toHaveBeenCalled();
    // The pruned version's S3 object is deleted too.
    expect(mockDelete).toHaveBeenCalledWith('test-bucket', 'questionnaire-versions/d/v1.xlsx');
  });
});

describe('listQuestionnaireVersions', () => {
  it('returns versions newest-first with db keys stripped', async () => {
    mockQueryAllBySkPrefix.mockResolvedValueOnce([
      { versionNumber: 1, documentId: 'd', snapshotFileKey: 'a', partition_key: PK, sort_key: 'o#p#opp#d#000001' },
      { versionNumber: 2, documentId: 'd', snapshotFileKey: 'b', partition_key: PK, sort_key: 'o#p#opp#d#000002' },
    ]);
    const versions = await listQuestionnaireVersions('o', 'p', 'opp', 'd');
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(versions[0]).not.toHaveProperty('partition_key');
    expect(versions[0]).not.toHaveProperty('sort_key');
  });
});

describe('revertQuestionnaireToVersion', () => {
  it('snapshots current (SYSTEM) then restores the target snapshot onto the live file', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'd', fileKey: 'o/p/opp/rfp-documents/d/live.xlsx' });
    // getQuestionnaireVersion(target=1) → an existing snapshot; listing is used
    // both for target lookup and the snapshot's version increment.
    mockGetItem.mockResolvedValueOnce({
      versionNumber: 1, documentId: 'd', snapshotFileKey: 'questionnaire-versions/d/v1.xlsx',
    });
    mockQueryAllBySkPrefix.mockResolvedValue([{ versionNumber: 1, snapshotFileKey: 'questionnaire-versions/d/v1.xlsx' }]);

    const { snapshotVersionNumber, fileKey } = await revertQuestionnaireToVersion({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 1, userId: 'u',
    });

    expect(fileKey).toBe('o/p/opp/rfp-documents/d/live.xlsx');
    expect(snapshotVersionNumber).toBe(2); // one more than the latest (1)
    // The LAST copy call restores the target snapshot onto the live file.
    expect(mockCopy).toHaveBeenLastCalledWith('test-bucket', 'questionnaire-versions/d/v1.xlsx', 'o/p/opp/rfp-documents/d/live.xlsx');
    // Default note carries the version context.
    expect(mockCreateItem.mock.calls[0][2].changeNote).toBe('Revert to version 1');
  });

  it('M1: forwards the user changeNote, appended to the version context', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'd', fileKey: 'o/p/opp/rfp-documents/d/live.xlsx' });
    mockGetItem.mockResolvedValueOnce({
      versionNumber: 1, documentId: 'd', snapshotFileKey: 'questionnaire-versions/d/v1.xlsx',
    });
    mockQueryAllBySkPrefix.mockResolvedValue([{ versionNumber: 1, snapshotFileKey: 'questionnaire-versions/d/v1.xlsx' }]);

    await revertQuestionnaireToVersion({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 1,
      userId: 'u', changeNote: 'reverting bad AI edit',
    });

    expect(mockCreateItem.mock.calls[0][2].changeNote).toBe('Revert to version 1: reverting bad AI edit');
  });

  it('throws when the questionnaire has no file', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'd', fileKey: null });
    await expect(
      revertQuestionnaireToVersion({ orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 1 }),
    ).rejects.toThrow('Questionnaire not found');
  });

  it('throws when the target version does not exist', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'd', fileKey: 'o/p/opp/rfp-documents/d/live.xlsx' });
    mockGetItem.mockResolvedValueOnce(null);
    await expect(
      revertQuestionnaireToVersion({ orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 9 }),
    ).rejects.toThrow('version 9 not found');
  });

  it('M2: rejects a doc whose file belongs to a different org (no cross-org revert)', async () => {
    // Doc exists but its fileKey is under org "other" — the caller is org "o".
    mockGetRFPDocument.mockResolvedValueOnce({
      documentId: 'd', fileKey: 'other/p/opp/rfp-documents/d/live.xlsx', orgId: 'other',
    });
    await expect(
      revertQuestionnaireToVersion({ orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 1 }),
    ).rejects.toThrow('Questionnaire not found');
    // Never touched the version lookup or any copy — bailed at the org guard.
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('C1: at the version cap, reverting to the OLDEST version does not prune the target before restoring it', async () => {
    // 30 stored versions (v1..v30) — exactly at the keep count. Reverting to v1
    // snapshots the current file as v31 (→ 31 rows), which triggers a prune. Without
    // protecting the target, prune would delete v1's S3 object, then the restore copy
    // would read a just-deleted key (NoSuchKey) and lose v1 permanently.
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'd', fileKey: 'o/p/opp/rfp-documents/d/live.xlsx' });
    mockGetItem.mockResolvedValueOnce({
      versionNumber: 1, documentId: 'd', snapshotFileKey: 'questionnaire-versions/d/v1.xlsx',
    });
    const desc = (hi: number, lo: number) =>
      Array.from({ length: hi - lo + 1 }, (_, i) => ({
        versionNumber: hi - i, // newest first
        snapshotFileKey: `questionnaire-versions/d/v${hi - i}.xlsx`,
      }));
    // getLatest sees 30 (v30..v1) → next is v31; prune then sees 31 (v31..v1).
    mockQueryAllBySkPrefix
      .mockResolvedValueOnce(desc(30, 1))
      .mockResolvedValueOnce(desc(31, 1));

    await revertQuestionnaireToVersion({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 1, userId: 'u',
    });

    // The target (v1) is the only row past the keep count, so protecting it leaves
    // nothing to prune this write — it must NOT be S3-deleted before we restore it.
    expect(mockDelete).not.toHaveBeenCalledWith('test-bucket', 'questionnaire-versions/d/v1.xlsx');
    // The restore reads v1's still-present object back onto the live file.
    expect(mockCopy).toHaveBeenLastCalledWith(
      'test-bucket', 'questionnaire-versions/d/v1.xlsx', 'o/p/opp/rfp-documents/d/live.xlsx',
    );
  });

  it('C1: reverting to a non-oldest version at the cap still prunes the genuine oldest', async () => {
    // 31 stored (v1..v31) reverting to v5 → snapshot v32 → 32 rows. slice(30) =
    // [v2, v1]; neither is the protected target (v5), so both prune normally.
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'd', fileKey: 'o/p/opp/rfp-documents/d/live.xlsx' });
    mockGetItem.mockResolvedValueOnce({
      versionNumber: 5, documentId: 'd', snapshotFileKey: 'questionnaire-versions/d/v5.xlsx',
    });
    const desc = (hi: number, lo: number) =>
      Array.from({ length: hi - lo + 1 }, (_, i) => ({
        versionNumber: hi - i,
        snapshotFileKey: `questionnaire-versions/d/v${hi - i}.xlsx`,
      }));
    mockQueryAllBySkPrefix
      .mockResolvedValueOnce(desc(31, 1))
      .mockResolvedValueOnce(desc(32, 1));

    await revertQuestionnaireToVersion({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 5, userId: 'u',
    });

    expect(mockDelete).toHaveBeenCalledWith('test-bucket', 'questionnaire-versions/d/v1.xlsx');
    expect(mockDelete).toHaveBeenCalledWith('test-bucket', 'questionnaire-versions/d/v2.xlsx');
    expect(mockDelete).not.toHaveBeenCalledWith('test-bucket', 'questionnaire-versions/d/v5.xlsx');
    expect(mockCopy).toHaveBeenLastCalledWith(
      'test-bucket', 'questionnaire-versions/d/v5.xlsx', 'o/p/opp/rfp-documents/d/live.xlsx',
    );
  });

  it('aborts (does NOT overwrite the live file) when the pre-revert snapshot fails', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'd', fileKey: 'o/p/opp/rfp-documents/d/live.xlsx' });
    mockGetItem.mockResolvedValueOnce({
      versionNumber: 1, documentId: 'd', snapshotFileKey: 'questionnaire-versions/d/v1.xlsx',
    });
    // snapshotQuestionnaire exhausts all attempts with conditional conflicts.
    const conflict = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
    mockQueryAllBySkPrefix.mockResolvedValue([{ versionNumber: 1, snapshotFileKey: 'questionnaire-versions/d/v1.xlsx' }]);
    mockCreateItem.mockRejectedValue(conflict);

    await expect(
      revertQuestionnaireToVersion({
        orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd', targetVersion: 1, userId: 'u',
      }),
    ).rejects.toThrow('Revert aborted');

    // The live file must never be overwritten when the snapshot couldn't be taken.
    expect(mockCopy).not.toHaveBeenCalledWith(
      'test-bucket', 'questionnaire-versions/d/v1.xlsx', 'o/p/opp/rfp-documents/d/live.xlsx',
    );
  });
});
