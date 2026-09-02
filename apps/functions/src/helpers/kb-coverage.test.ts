/**
 * Probes are tested at the AWS SDK boundary rather than by mocking
 * `@/helpers/db`, so the real `queryAllBySkPrefix` pagination and the real
 * `getCompanyProfile` GetItem run — pagination truncation is exactly the bug
 * this probe must not have.
 */
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  ScanCommand: jest.fn((params) => ({ type: 'Scan', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { CONTENT_LIBRARY_PK } from '@auto-rfp/core';

import { ORG_PK } from '@/constants/organization';
import { PK_NAME } from '@/constants/common';

import {
  buildKBCoverageReport,
  computeKBCoverageSnapshot,
  isKBCoverageGateArmed,
  resolveProbeSources,
} from './kb-coverage';

type Cmd = { type: string; params: Record<string, unknown> };

const queries = (): Cmd[] => mockSend.mock.calls.map(([c]) => c as Cmd).filter((c) => c.type === 'Query');
const gets = (): Cmd[] => mockSend.mock.calls.map(([c]) => c as Cmd).filter((c) => c.type === 'Get');

const pkOf = (cmd: Cmd): string =>
  String((cmd.params.Key as Record<string, unknown> | undefined)?.[PK_NAME] ?? '');

/** Route by command type and partition key: Query → content library, Get → profile or org. */
const stub = (opts: {
  contentLibraryPages?: { Items: unknown[]; LastEvaluatedKey?: Record<string, unknown> }[];
  profile?: unknown;
  org?: unknown;
}) => {
  const pages = opts.contentLibraryPages ?? [{ Items: [] }];
  let pageIndex = 0;
  mockSend.mockImplementation(async (cmd: Cmd) => {
    if (cmd.type === 'Query') return pages[pageIndex++] ?? { Items: [] };
    if (cmd.type === 'Get') {
      if (pkOf(cmd) === ORG_PK) return { Item: opts.org ?? undefined };
      return { Item: opts.profile ?? undefined };
    }
    throw new Error(`unexpected command ${cmd.type}`);
  });
};

const field = (category: string, value: string) => ({
  key: `k-${category}-${value}`,
  label: category,
  value,
  category,
  verified: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('resolveProbeSources', () => {
  it('should need only the company profile for INSURANCE', () => {
    expect(resolveProbeSources(['INSURANCE'])).toEqual({
      contentLibrary: false,
      companyProfile: true,
    });
  });

  it('should need only the content library for PERSONNEL_BIOS', () => {
    expect(resolveProbeSources(['PERSONNEL_BIOS'])).toEqual({
      contentLibrary: true,
      companyProfile: false,
    });
  });

  it('should need both sources for CERTIFICATIONS', () => {
    // Certs legitimately live in either place, so either satisfies the check.
    expect(resolveProbeSources(['CERTIFICATIONS'])).toEqual({
      contentLibrary: true,
      companyProfile: true,
    });
  });

  it('should need nothing when no categories are required', () => {
    expect(resolveProbeSources([])).toEqual({ contentLibrary: false, companyProfile: false });
  });
});

describe('computeKBCoverageSnapshot — content library probe', () => {
  it('should match an alias case- and whitespace-insensitively', async () => {
    stub({ contentLibraryPages: [{ Items: [{ category: '  KEY personnel  ' }] }] });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(snapshot.PERSONNEL_BIOS).toEqual({ present: true, count: 1 });
  });

  it('should query the content library partition scoped to the org', async () => {
    stub({ contentLibraryPages: [{ Items: [] }] });

    await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    const [query] = queries();
    expect(query.params.ExpressionAttributeValues).toMatchObject({
      ':pk': CONTENT_LIBRARY_PK,
      ':skPrefix': 'org-1#',
    });
    expect(query.params.ProjectionExpression).toBe('category, isArchived, approvalStatus');
  });

  it('should report a category absent when no item matches an alias', async () => {
    stub({ contentLibraryPages: [{ Items: [{ category: 'Our People' }] }] });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(snapshot.PERSONNEL_BIOS).toEqual({ present: false, count: 0 });
  });

  it('should not count archived items', async () => {
    stub({
      contentLibraryPages: [
        { Items: [{ category: 'Key Personnel', isArchived: true }, { category: 'Bios', isArchived: true }] },
      ],
    });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(snapshot.PERSONNEL_BIOS).toEqual({ present: false, count: 0 });
  });

  it('should not count DEPRECATED items', async () => {
    stub({
      contentLibraryPages: [{ Items: [{ category: 'Key Personnel', approvalStatus: 'DEPRECATED' }] }],
    });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(snapshot.PERSONNEL_BIOS).toEqual({ present: false, count: 0 });
  });

  it('should count DRAFT and APPROVED items', async () => {
    stub({
      contentLibraryPages: [
        {
          Items: [
            { category: 'Key Personnel', approvalStatus: 'DRAFT' },
            { category: 'Resumes', approvalStatus: 'APPROVED' },
          ],
        },
      ],
    });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(snapshot.PERSONNEL_BIOS).toEqual({ present: true, count: 2 });
  });

  it('should skip items with no category', async () => {
    stub({ contentLibraryPages: [{ Items: [{ isArchived: false }, { category: '' }] }] });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(snapshot.PERSONNEL_BIOS).toEqual({ present: false, count: 0 });
  });

  it('should read every page, not just the first', async () => {
    // The existing content-library/categories handler ignores LastEvaluatedKey
    // and truncates at 1 MB; a truncated read here would block generation on a
    // category the org actually has.
    stub({
      contentLibraryPages: [
        { Items: [{ category: 'Pricing' }], LastEvaluatedKey: { sort_key: 'org-1#a' } },
        { Items: [{ category: 'Key Personnel' }] },
      ],
    });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(queries()).toHaveLength(2);
    expect(snapshot.PERSONNEL_BIOS).toEqual({ present: true, count: 1 });
  });
});

describe('computeKBCoverageSnapshot — company profile probe', () => {
  it('should count a certification field with a value', async () => {
    stub({ profile: { orgId: 'org-1', fields: [field('CERTIFICATION', '8(a) #12345')] } });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['INSURANCE', 'CERTIFICATIONS']);

    expect(snapshot.CERTIFICATIONS).toEqual({ present: true, count: 1 });
  });

  it('should not count a field with an empty value', async () => {
    // The profile seeds rows for fields the org has not filled in yet.
    stub({ profile: { orgId: 'org-1', fields: [field('INSURANCE', ''), field('INSURANCE', '   ')] } });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['INSURANCE']);

    expect(snapshot.INSURANCE).toEqual({ present: false, count: 0 });
  });

  it('should ignore fields in unrelated categories', async () => {
    stub({ profile: { orgId: 'org-1', fields: [field('IDENTITY', 'Acme Inc'), field('CONTACT', 'a@b.c')] } });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['INSURANCE']);

    expect(snapshot.INSURANCE).toEqual({ present: false, count: 0 });
  });

  it('should report absent rather than throw when the org has no profile', async () => {
    stub({ profile: undefined });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['INSURANCE']);

    expect(snapshot.INSURANCE).toEqual({ present: false, count: 0 });
  });

  it('should tolerate a profile with no fields array', async () => {
    stub({ profile: { orgId: 'org-1' } });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['INSURANCE']);

    expect(snapshot.INSURANCE).toEqual({ present: false, count: 0 });
  });
});

describe('computeKBCoverageSnapshot — source selection', () => {
  it('should skip the content-library query for an INSURANCE-only requirement', async () => {
    stub({ profile: { orgId: 'org-1', fields: [] } });

    await computeKBCoverageSnapshot('org-1', ['INSURANCE']);

    expect(queries()).toHaveLength(0);
    expect(gets()).toHaveLength(1);
  });

  it('should skip the profile GetItem for a PERSONNEL_BIOS-only requirement', async () => {
    stub({ contentLibraryPages: [{ Items: [] }] });

    await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(gets()).toHaveLength(0);
    expect(queries()).toHaveLength(1);
  });

  it('should read nothing at all when no categories are required', async () => {
    stub({});

    const snapshot = await computeKBCoverageSnapshot('org-1', []);

    expect(mockSend).not.toHaveBeenCalled();
    expect(snapshot).toEqual({});
  });

  it('should omit categories whose source was not probed', async () => {
    // Reporting present: false for a source we never read would look like a
    // real gap; downstream treats an omitted category as missing.
    stub({ contentLibraryPages: [{ Items: [{ category: 'Key Personnel' }] }] });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['PERSONNEL_BIOS']);

    expect(snapshot).toEqual({ PERSONNEL_BIOS: { present: true, count: 1 } });
    expect(snapshot.INSURANCE).toBeUndefined();
  });

  it('should probe every source when no requirement is given', async () => {
    stub({
      contentLibraryPages: [{ Items: [{ category: 'Qualifications' }] }],
      profile: { orgId: 'org-1', fields: [field('INSURANCE', 'GL policy #1')] },
    });

    const snapshot = await computeKBCoverageSnapshot('org-1');

    expect(queries()).toHaveLength(1);
    expect(gets()).toHaveLength(1);
    expect(snapshot).toEqual({
      PERSONNEL_BIOS: { present: false, count: 0 },
      CERTIFICATIONS: { present: true, count: 1 },
      INSURANCE: { present: true, count: 1 },
    });
  });

  it('should satisfy CERTIFICATIONS from either source', async () => {
    stub({
      contentLibraryPages: [{ Items: [{ category: 'Qualifications' }] }],
      profile: { orgId: 'org-1', fields: [field('CERTIFICATION', 'ISO 9001')] },
    });

    const snapshot = await computeKBCoverageSnapshot('org-1', ['CERTIFICATIONS']);

    // Counts sum across both sources.
    expect(snapshot.CERTIFICATIONS).toEqual({ present: true, count: 2 });
  });
});

describe('isKBCoverageGateArmed', () => {
  afterEach(() => {
    delete process.env.KB_COVERAGE_GATING;
  });

  it('should be armed when the org flag is on and gating is not disabled', () => {
    expect(isKBCoverageGateArmed({ enableKBCoverageGate: true })).toBe(true);
  });

  it('should not be armed when the org flag is off', () => {
    expect(isKBCoverageGateArmed({ enableKBCoverageGate: false })).toBe(false);
    expect(isKBCoverageGateArmed({})).toBe(false);
  });

  it('should not be armed for a missing org record', () => {
    expect(isKBCoverageGateArmed(null)).toBe(false);
  });

  it('should not be armed when the stage-wide switch is off', () => {
    process.env.KB_COVERAGE_GATING = 'off';
    expect(isKBCoverageGateArmed({ enableKBCoverageGate: true })).toBe(false);
  });
});

describe('buildKBCoverageReport', () => {
  afterEach(() => {
    delete process.env.KB_COVERAGE_GATING;
  });

  it('should report the snapshot, the per-document-type gaps, and the gate state', async () => {
    stub({
      contentLibraryPages: [{ Items: [{ category: 'Certifications' }] }],
      profile: { orgId: 'org-1', fields: [] },
      org: { id: 'org-1', enableKBCoverageGate: true },
    });

    const report = await buildKBCoverageReport('org-1');

    expect(report.snapshot).toEqual({
      PERSONNEL_BIOS: { present: false, count: 0 },
      CERTIFICATIONS: { present: true, count: 1 },
      INSURANCE: { present: false, count: 0 },
    });
    // The aggregate gap list the KB owner reads is derived from the same probe.
    expect(report.byDocumentType.TEAM_QUALIFICATIONS).toEqual({
      covered: false,
      missing: [{ key: 'PERSONNEL_BIOS', label: 'personnel bios' }],
    });
    expect(report.byDocumentType.CERTIFICATIONS).toEqual({ covered: true, missing: [] });
    expect(report.isGateEnabled).toBe(true);
  });

  it('should probe every category regardless of document type', async () => {
    stub({ org: null });

    await buildKBCoverageReport('org-1');

    expect(queries()).toHaveLength(1);
    // One profile Get plus one org Get.
    expect(gets()).toHaveLength(2);
  });

  it('should report the gate disabled when the org flag is off', async () => {
    stub({ org: { id: 'org-1' } });

    const report = await buildKBCoverageReport('org-1');

    expect(report.isGateEnabled).toBe(false);
    // Gaps are still reported — warn-only is the default posture.
    expect(report.byDocumentType.TEAM_QUALIFICATIONS.covered).toBe(false);
  });

  it('should report the gate disabled when the stage-wide switch is off', async () => {
    process.env.KB_COVERAGE_GATING = 'off';
    stub({ org: { id: 'org-1', enableKBCoverageGate: true } });

    const report = await buildKBCoverageReport('org-1');

    expect(report.isGateEnabled).toBe(false);
  });
});
