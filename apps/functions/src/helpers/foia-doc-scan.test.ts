process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

import { mergeCandidates, scoreFoiaEmailCandidates } from './foia-doc-scan';

describe('scoreFoiaEmailCandidates', () => {
  it('ranks a FOIA-office address above a contracting-officer address', () => {
    const text = `
      SECTION G - CONTRACT ADMINISTRATION
      The Contracting Officer for this action is Jane Roe, contracting.officer@army.mil.

      SECTION H - FREEDOM OF INFORMATION ACT
      Requests under the Freedom of Information Act should be directed to the
      FOIA Officer at foia.office@army.mil.
    `;

    const candidates = scoreFoiaEmailCandidates(text);

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]?.email).toBe('foia.office@army.mil');
    expect(candidates[0]!.score).toBeGreaterThan(candidates[1]!.score);
  });

  it('finds a state public-records officer address', () => {
    const text = `
      Public Records Officer
      All public records requests shall be submitted to records@dgs.ca.gov.
    `;

    const candidates = scoreFoiaEmailCandidates(text);

    expect(candidates[0]?.email).toBe('records@dgs.ca.gov');
  });

  it('excludes an address with no records-related keyword anywhere near it', () => {
    const text = `
      FOIA Officer: foia@agency.gov

      ${'filler text '.repeat(200)}

      For invoicing questions contact accounts.payable@agency.gov.
    `;

    const candidates = scoreFoiaEmailCandidates(text);
    const emails = candidates.map((c) => c.email);

    expect(emails).toContain('foia@agency.gov');
    expect(emails).not.toContain('accounts.payable@agency.gov');
  });

  it('ignores commercial addresses — only .gov, .mil and .us are plausible', () => {
    const text = `
      FOIA Officer questions may go to foia@agency.gov or to our
      support vendor at helpdesk@contractor.com or sales@vendor.io.
    `;

    const emails = scoreFoiaEmailCandidates(text).map((c) => c.email);

    expect(emails).toEqual(['foia@agency.gov']);
  });

  it('excludes no-reply and postmaster style mailboxes', () => {
    const text = `
      FOIA requests: no-reply@agency.gov, donotreply@agency.gov,
      postmaster@agency.gov, and the real one foia@agency.gov.
    `;

    const emails = scoreFoiaEmailCandidates(text).map((c) => c.email);

    expect(emails).toEqual(['foia@agency.gov']);
  });

  it('excludes the solicitation portal itself', () => {
    const text = 'FOIA notices are posted via noreply@sam.gov and handled by foia@gsa.gov.';

    const emails = scoreFoiaEmailCandidates(text).map((c) => c.email);

    expect(emails).not.toContain('noreply@sam.gov');
    expect(emails).toContain('foia@gsa.gov');
  });

  it('returns nothing when the document has no records keywords at all', () => {
    const text = 'Deliverables shall be shipped to the address in Section F. Contact bob@army.mil.';

    expect(scoreFoiaEmailCandidates(text)).toEqual([]);
  });

  it('returns nothing for empty text', () => {
    expect(scoreFoiaEmailCandidates('')).toEqual([]);
  });

  it('deduplicates one address keeping its best score', () => {
    const text = `
      Point of contact: foia@agency.gov
      FOIA Officer and Freedom of Information Act requests: foia@agency.gov
    `;

    const candidates = scoreFoiaEmailCandidates(text);
    const matches = candidates.filter((c) => c.email === 'foia@agency.gov');

    expect(matches).toHaveLength(1);
    // Kept the higher-scoring occurrence, not the weak "point of contact" one.
    expect(matches[0]!.score).toBeGreaterThan(1);
  });

  it('lowercases addresses so casing variants collapse', () => {
    const text = 'FOIA Officer: FOIA.Office@Army.Mil and foia.office@army.mil';

    const candidates = scoreFoiaEmailCandidates(text);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.email).toBe('foia.office@army.mil');
  });

  it('captures surrounding context so a human can judge the match', () => {
    const text = 'Submit FOIA requests to the FOIA Officer at foia@agency.gov within 30 days.';

    const [candidate] = scoreFoiaEmailCandidates(text);

    expect(candidate?.context).toContain('FOIA Officer');
    expect(candidate?.context.length).toBeLessThanOrEqual(500);
  });

  it('records the source file name when provided', () => {
    const text = 'FOIA Officer: foia@agency.gov';

    const [candidate] = scoreFoiaEmailCandidates(text, 'RFP-Section-H.pdf');

    expect(candidate?.sourceFileName).toBe('RFP-Section-H.pdf');
  });

  it('is repeatable — global regex state does not leak between calls', () => {
    const text = 'FOIA Officer: foia@agency.gov';

    const first = scoreFoiaEmailCandidates(text);
    const second = scoreFoiaEmailCandidates(text);
    const third = scoreFoiaEmailCandidates(text);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

describe('mergeCandidates', () => {
  it('keeps the highest score for an address seen in several documents', () => {
    const merged = mergeCandidates([
      [{ email: 'foia@agency.gov', context: 'weak mention', score: 3 }],
      [{ email: 'foia@agency.gov', context: 'FOIA Officer', score: 16 }],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.score).toBe(16);
    expect(merged[0]?.context).toBe('FOIA Officer');
  });

  it('sorts by score descending', () => {
    const merged = mergeCandidates([
      [{ email: 'low@agency.gov', context: 'c', score: 2 }],
      [{ email: 'high@agency.gov', context: 'c', score: 20 }],
      [{ email: 'mid@agency.gov', context: 'c', score: 9 }],
    ]);

    expect(merged.map((c) => c.email)).toEqual([
      'high@agency.gov',
      'mid@agency.gov',
      'low@agency.gov',
    ]);
  });

  it('caps the shortlist at three so the user is not asked to triage noise', () => {
    const merged = mergeCandidates([
      [
        { email: 'a@agency.gov', context: 'c', score: 10 },
        { email: 'b@agency.gov', context: 'c', score: 9 },
        { email: 'c@agency.gov', context: 'c', score: 8 },
        { email: 'd@agency.gov', context: 'c', score: 7 },
        { email: 'e@agency.gov', context: 'c', score: 6 },
      ],
    ]);

    expect(merged).toHaveLength(3);
    expect(merged.map((c) => c.email)).toEqual(['a@agency.gov', 'b@agency.gov', 'c@agency.gov']);
  });

  it('returns an empty list when nothing was found', () => {
    expect(mergeCandidates([[], []])).toEqual([]);
  });
});
