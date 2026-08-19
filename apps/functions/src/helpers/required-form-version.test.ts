import { gzipSync } from 'node:zlib';

import fc from 'fast-check';

// ── Mock db + sibling helpers before importing the module under test ──────────
const mockCreateItem = jest.fn();
const mockQueryAllBySkPrefix = jest.fn();
const mockGetItem = jest.fn();
const mockBatchDeleteItems = jest.fn();
jest.mock('@/helpers/db', () => ({
  createItem: (...a: unknown[]) => mockCreateItem(...a),
  queryAllBySkPrefix: (...a: unknown[]) => mockQueryAllBySkPrefix(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  batchDeleteItems: (...a: unknown[]) => mockBatchDeleteItems(...a),
  // Keep the real predicate so the retry loop recognises the conflict error.
  isConditionalCheckFailed: (err: unknown) =>
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ConditionalCheckFailedException',
}));

const mockGetRequiredForm = jest.fn();
const mockUpdateRequiredForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  getRequiredForm: (...a: unknown[]) => mockGetRequiredForm(...a),
  updateRequiredForm: (...a: unknown[]) => mockUpdateRequiredForm(...a),
}));

import type { DetectedFormField } from '@auto-rfp/core';
import {
  buildRequiredFormVersionSk,
  buildRequiredFormVersionPrefix,
  snapshotFormFields,
  listFormVersions,
  getFormVersion,
  revertFormToVersion,
} from './required-form-version';

const REQUIRED_FORM_VERSION_PK = 'REQUIRED_FORM_VERSION';

const buildField = (overrides: Partial<DetectedFormField> = {}): DetectedFormField => ({
  fieldId: 'f1',
  label: 'Field',
  value: null,
  status: 'EMPTY',
  confidence: null,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: null,
  cellReference: null,
  sheetName: null,
  sheetIndex: null,
  boundingBox: null,
  markType: 'TEXT',
  markChar: null,
  markGeometry: null,
  matrixCategory: null,
  matrixFeature: null,
  matrixColumn: 'OTHER',
  docxAnchor: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchDeleteItems.mockResolvedValue({ deleted: 0, failed: 0 });
});

// ─── Example-based tests ───────────────────────────────────────────────────────

describe('SK builders', () => {
  it('zero-pads the version to 6 digits', () => {
    expect(buildRequiredFormVersionSk('o', 'p', 'opp', 'form', 3)).toBe('o#p#opp#form#000003');
    expect(buildRequiredFormVersionSk('o', 'p', 'opp', 'form', 123456)).toBe('o#p#opp#form#123456');
  });

  it('prefix is a prefix of the full SK for the same ids', () => {
    const prefix = buildRequiredFormVersionPrefix('o', 'p', 'opp', 'form');
    const sk = buildRequiredFormVersionSk('o', 'p', 'opp', 'form', 7);
    expect(sk.startsWith(prefix)).toBe(true);
  });
});

describe('snapshotFormFields', () => {
  it('writes version latest+1 with compressed fields and prunes', async () => {
    // Existing versions: highest is 2.
    mockQueryAllBySkPrefix.mockResolvedValueOnce([
      { versionNumber: 1, fields: [] },
      { versionNumber: 2, fields: [] },
    ]);
    // Prune query (after write)
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]);
    mockCreateItem.mockResolvedValueOnce({});

    const form = {
      orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form',
      fields: [buildField({ value: 'v' })],
    };
    const version = await snapshotFormFields({ form, source: 'MANUAL', userId: 'u1' });

    expect(version).toBe(3);
    const [pk, sk, item] = mockCreateItem.mock.calls[0];
    expect(pk).toBe(REQUIRED_FORM_VERSION_PK);
    expect(sk).toBe('o#p#opp#form#000003');
    expect(item.source).toBe('MANUAL');
    expect(item.createdBy).toBe('u1');
    expect(item.fields).toEqual([]); // inline empty
    expect(item.fieldsGz).toBeInstanceOf(Uint8Array); // compressed payload present
  });

  it('starts at version 1 when there is no history', async () => {
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]); // latest lookup
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]); // prune
    mockCreateItem.mockResolvedValueOnce({});

    const version = await snapshotFormFields({
      form: { orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', fields: [] },
      source: 'AI_MASS_EDIT',
    });
    expect(version).toBe(1);
  });

  it('recomputes and retries the version number on a concurrent-write race (H1)', async () => {
    const conflict = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
    // Attempt 1: latest=2 → try v3 → collision (another writer took v3).
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 2, fields: [] }]);
    mockCreateItem.mockRejectedValueOnce(conflict);
    // Attempt 2: latest now 3 → try v4 → succeeds.
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 3, fields: [] }]);
    mockCreateItem.mockResolvedValueOnce({});
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]); // prune

    const version = await snapshotFormFields({
      form: { orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', fields: [] },
      source: 'MANUAL',
    });

    expect(version).toBe(4);
    expect(mockCreateItem).toHaveBeenCalledTimes(2);
    expect(mockCreateItem.mock.calls[1][1]).toBe('o#p#opp#form#000004');
  });

  it('propagates a non-conditional error without retrying', async () => {
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 1, fields: [] }]);
    mockCreateItem.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalServerError' }));

    await expect(
      snapshotFormFields({
        form: { orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', fields: [] },
        source: 'MANUAL',
      }),
    ).rejects.toThrow('boom');
    expect(mockCreateItem).toHaveBeenCalledTimes(1);
  });

  it('does NOT fail the snapshot when prune throws after the row commits (best-effort)', async () => {
    // Latest is 40 (over the keep count) so a prune is attempted; its batch delete
    // throws. The row already committed, so the snapshot must still succeed —
    // otherwise a revert would abort with a misleading "could not snapshot".
    const existing = Array.from({ length: 40 }, (_, i) => ({ versionNumber: 40 - i, fields: [] }));
    mockQueryAllBySkPrefix.mockResolvedValueOnce(existing); // latest lookup
    mockCreateItem.mockResolvedValueOnce({}); // row commits (v41)
    mockQueryAllBySkPrefix.mockResolvedValueOnce(existing.map((v) => ({ versionNumber: v.versionNumber }))); // prune list
    mockBatchDeleteItems.mockRejectedValueOnce(new Error('dynamo throttled'));

    const version = await snapshotFormFields({
      form: { orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', fields: [] },
      source: 'MANUAL',
    });

    expect(version).toBe(41); // committed despite the prune failure
    expect(mockBatchDeleteItems).toHaveBeenCalled();
  });
});

describe('listFormVersions', () => {
  it('returns newest-first and decodes compressed fields', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from(JSON.stringify([buildField({ value: 'x' })]))));
    mockQueryAllBySkPrefix.mockResolvedValueOnce([
      { versionNumber: 1, partition_key: 'pk', sort_key: 'sk', fieldsGz: gz, fields: [] },
      { versionNumber: 2, partition_key: 'pk', sort_key: 'sk', fieldsGz: gz, fields: [] },
    ]);

    const versions = await listFormVersions('o', 'p', 'opp', 'form');
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(versions[0].fields[0].value).toBe('x');
    // Single-table keys stripped from the domain entity.
    expect((versions[0] as Record<string, unknown>).partition_key).toBeUndefined();
    expect((versions[0] as Record<string, unknown>).fieldsGz).toBeUndefined();
  });
});

describe('getFormVersion', () => {
  it('returns null when the version does not exist', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    expect(await getFormVersion('o', 'p', 'opp', 'form', 9)).toBeNull();
  });
});

describe('revertFormToVersion', () => {
  it('snapshots current, then writes the target version fields back', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form',
      fields: [buildField({ value: 'current' })],
    });
    // getFormVersion(target)
    const targetGz = new Uint8Array(
      gzipSync(Buffer.from(JSON.stringify([buildField({ value: 'old', status: 'AUTO_FILLED' })]))),
    );
    mockGetItem.mockResolvedValueOnce({
      versionNumber: 1, partition_key: 'pk', sort_key: 'sk', fieldsGz: targetGz, fields: [],
    });
    // snapshotFormFields internals: latest lookup + prune
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 1, fields: [] }]);
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]);
    mockCreateItem.mockResolvedValueOnce({});
    mockUpdateRequiredForm.mockResolvedValueOnce({ formId: 'form' });

    const { snapshotVersionNumber } = await revertFormToVersion({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', targetVersion: 1, userId: 'u1',
    });

    expect(snapshotVersionNumber).toBe(2);
    const patch = mockUpdateRequiredForm.mock.calls[0][0].patch;
    expect(patch.fields[0].value).toBe('old');
    expect(patch.totalFieldCount).toBe(1);
    expect(patch.autoFillPercentage).toBe(100);
    // Default note carries the "which version" context.
    expect(mockCreateItem.mock.calls[0][2].changeNote).toBe('Revert to version 1');
  });

  it('M1: forwards the user changeNote, appended to the version context', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form',
      fields: [buildField({ value: 'current' })],
    });
    const targetGz = new Uint8Array(gzipSync(Buffer.from(JSON.stringify([buildField({ value: 'old' })]))));
    mockGetItem.mockResolvedValueOnce({ versionNumber: 1, fieldsGz: targetGz, fields: [] });
    mockQueryAllBySkPrefix.mockResolvedValueOnce([{ versionNumber: 1, fields: [] }]);
    mockQueryAllBySkPrefix.mockResolvedValueOnce([]);
    mockCreateItem.mockResolvedValueOnce({});
    mockUpdateRequiredForm.mockResolvedValueOnce({ formId: 'form' });

    await revertFormToVersion({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', targetVersion: 1,
      userId: 'u1', changeNote: 'wrong data entered',
    });

    expect(mockCreateItem.mock.calls[0][2].changeNote).toBe('Revert to version 1: wrong data entered');
  });

  it('throws when the target version is missing', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', fields: [],
    });
    mockGetItem.mockResolvedValueOnce(null);
    await expect(
      revertFormToVersion({ orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', targetVersion: 5 }),
    ).rejects.toThrow('Form version 5 not found');
  });

  it('aborts (does NOT overwrite current fields) when the pre-revert snapshot fails', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form',
      fields: [buildField({ value: 'current' })],
    });
    const targetGz = new Uint8Array(gzipSync(Buffer.from(JSON.stringify([buildField({ value: 'old' })]))));
    mockGetItem.mockResolvedValueOnce({ versionNumber: 1, fieldsGz: targetGz, fields: [] });
    // snapshotFormFields: exhaust all attempts with conditional conflicts.
    const conflict = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
    mockQueryAllBySkPrefix.mockResolvedValue([{ versionNumber: 1, fields: [] }]);
    mockCreateItem.mockRejectedValue(conflict);

    await expect(
      revertFormToVersion({
        orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', targetVersion: 1, userId: 'u1',
      }),
    ).rejects.toThrow('Revert aborted');

    // The current fields must never be overwritten when the snapshot couldn't be taken.
    expect(mockUpdateRequiredForm).not.toHaveBeenCalled();
  });
});

// ─── Property-based tests (PBT-02 round-trip, PBT-03 invariant) ──────────────────
// Framework: fast-check (PBT-09). Shrinking on by default; seed logged on failure (PBT-08).

const fieldArb: fc.Arbitrary<DetectedFormField> = fc.record({
  fieldId: fc.string(),
  label: fc.string(),
  value: fc.option(fc.string(), { nil: null }),
  status: fc.constantFrom('AUTO_FILLED', 'MANUAL_REQUIRED', 'LOW_CONFIDENCE', 'EMPTY'),
  matrixColumn: fc.constantFrom('FULLY_MEETS', 'PARTIALLY_MEETS', 'CANNOT_MEET', 'COMMENTS', 'OTHER'),
}).map((partial) => buildField(partial as Partial<DetectedFormField>));

describe('PBT — form-version helper', () => {
  it('PBT-02: snapshot fields compress→decompress round-trips (encode then read via listFormVersions)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fieldArb, { maxLength: 25 }), async (fields) => {
        // Capture the compressed payload snapshotFormFields writes...
        mockQueryAllBySkPrefix.mockResolvedValueOnce([]); // latest
        mockQueryAllBySkPrefix.mockResolvedValueOnce([]); // prune
        let captured: Uint8Array | undefined;
        mockCreateItem.mockImplementationOnce(async (_pk, _sk, item) => {
          captured = (item as { fieldsGz?: Uint8Array }).fieldsGz;
          return item;
        });
        await snapshotFormFields({
          form: { orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'form', fields },
          source: 'AI_FILL',
        });
        // ...then decode it back via a listFormVersions read of that same payload.
        mockQueryAllBySkPrefix.mockResolvedValueOnce([
          { versionNumber: 1, partition_key: 'pk', sort_key: 'sk', fieldsGz: captured, fields: [] },
        ]);
        const [v] = await listFormVersions('o', 'p', 'opp', 'form');
        expect(v.fields).toEqual(fields);
      }),
      { numRuns: 40 },
    );
  });

  it('PBT-03: SK builder always yields "{a}#{b}#{c}#{d}#{6-digit}" and prefix is always a prefix', () => {
    const idArb = fc.string({ minLength: 1 }).filter((s) => !s.includes('#'));
    fc.assert(
      fc.property(idArb, idArb, idArb, idArb, fc.integer({ min: 1, max: 999999 }), (o, p, opp, form, n) => {
        const sk = buildRequiredFormVersionSk(o, p, opp, form, n);
        const prefix = buildRequiredFormVersionPrefix(o, p, opp, form);
        expect(sk).toBe(`${o}#${p}#${opp}#${form}#${String(n).padStart(6, '0')}`);
        expect(sk.startsWith(prefix)).toBe(true);
        // trailing segment is exactly 6 chars for n < 1e6
        expect(sk.slice(prefix.length)).toHaveLength(6);
      }),
      { numRuns: 100 },
    );
  });
});
