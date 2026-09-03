// Mock module-load-time and I/O dependencies before importing the module.
jest.mock('@/helpers/bedrock-http-client', () => ({ invokeModel: jest.fn() }));
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  loadAllSolicitationTexts: jest.fn(),
  getExecutiveBriefByProjectId: jest.fn(),
}));

import {
  normalizeFormNameKey,
  parseExpectedFormsResponse,
  crossCheckMissingForms,
  getExpectedFormsFromBrief,
  extractExpectedFormsFromSolicitation,
  buildExpectedForms,
  computeMissingFormFindings,
} from './compliance-review-missing-forms';
import { invokeModel } from '@/helpers/bedrock-http-client';
import {
  loadAllSolicitationTexts,
  getExecutiveBriefByProjectId,
} from '@/helpers/executive-opportunity-brief';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';

const mockInvokeModel = invokeModel as jest.Mock;
const mockLoadSolicitation = loadAllSolicitationTexts as jest.Mock;
const mockGetBrief = getExecutiveBriefByProjectId as jest.Mock;

const inventoryWithForms = (names: string[]): PackageInventory => ({
  documents: [],
  forms: names.map((name, i) => ({
    formId: `form-${i}`,
    name,
    targetKind: 'PDF_FORM',
    fields: [],
  })),
});

/** Encode a model response body the way the Bedrock HTTP client returns it. */
const modelResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeFormNameKey', () => {
  it('lowercases, collapses whitespace, and strips punctuation', () => {
    expect(normalizeFormNameKey('  SF-33   (Solicitation) ')).toBe('sf33 solicitation');
  });

  it('strips continuation markers', () => {
    expect(normalizeFormNameKey('Certification Form (cont.)')).toBe('certification form');
    expect(normalizeFormNameKey('Certification Form - continued')).toBe('certification form');
  });

  it('returns empty string for punctuation-only names', () => {
    expect(normalizeFormNameKey('---')).toBe('');
  });
});

describe('parseExpectedFormsResponse', () => {
  it('reads a string array', () => {
    expect(parseExpectedFormsResponse({ forms: ['SF-33', 'Attachment A'] })).toEqual([
      'SF-33',
      'Attachment A',
    ]);
  });

  it('reads an array of { name } objects', () => {
    expect(parseExpectedFormsResponse({ forms: [{ name: 'SF-1449' }, { name: 'Exhibit 1' }] })).toEqual([
      'SF-1449',
      'Exhibit 1',
    ]);
  });

  it('trims and drops empty entries', () => {
    expect(parseExpectedFormsResponse({ forms: ['  SF-33 ', '', '   ', { name: '' }] })).toEqual([
      'SF-33',
    ]);
  });

  it('returns [] for malformed shapes', () => {
    expect(parseExpectedFormsResponse(null)).toEqual([]);
    expect(parseExpectedFormsResponse({})).toEqual([]);
    expect(parseExpectedFormsResponse({ forms: 'nope' })).toEqual([]);
    expect(parseExpectedFormsResponse('string')).toEqual([]);
  });
});

describe('crossCheckMissingForms', () => {
  it('flags an expected form that is not present', () => {
    const findings = crossCheckMissingForms(
      ['SF-33', 'Attachment A'],
      inventoryWithForms(['Attachment A']),
      [],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.issueType).toBe('MISSING_FORM');
    expect(findings[0]!.targetKind).toBe('FORM_MISSING');
    expect(findings[0]!.severity).toBe('major');
    expect(findings[0]!.title).toContain('SF-33');
  });

  it('does not flag a present form (exact normalized match)', () => {
    const findings = crossCheckMissingForms(
      ['Attachment A'],
      inventoryWithForms(['attachment a']),
      [],
    );
    expect(findings).toHaveLength(0);
  });

  it('matches by containment (short solicitation name inside a longer package name)', () => {
    const findings = crossCheckMissingForms(
      ['SF-33'],
      inventoryWithForms(['SF-33 Solicitation, Offer and Award']),
      [],
    );
    expect(findings).toHaveLength(0);
  });

  it('matches by containment (long solicitation name, short package name)', () => {
    const findings = crossCheckMissingForms(
      ['Standard Form 1449 Commercial'],
      inventoryWithForms(['Standard Form 1449']),
      [],
    );
    expect(findings).toHaveLength(0);
  });

  it('does not let a very short token match everything', () => {
    // "SF" normalizes to a 2-char key (< MISSING_FORM_MIN_MATCH_LEN); it must not
    // be treated as present just because "sf1449" contains "sf".
    const findings = crossCheckMissingForms(['SF'], inventoryWithForms(['SF-1449 Something']), []);
    expect(findings).toHaveLength(1);
  });

  it('flags "Attachment 1" as missing even when "Attachment 10" is present (numbered-sibling collision)', () => {
    // Regression (WR-1): plain substring containment treated "attachment 1" as a
    // match for "attachment 10", silently dropping a genuinely missing form.
    const findings = crossCheckMissingForms(
      ['Attachment 1'],
      inventoryWithForms(['Attachment 10']),
      [],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain('Attachment 1');
  });

  it('flags "SF-3" as missing even when "SF-30" is present (numbered collision after punctuation strip)', () => {
    // "SF-3"/"SF-30" normalize to "sf3"/"sf30"; "sf30".includes("sf3") must not
    // count as present.
    const findings = crossCheckMissingForms(['SF-3'], inventoryWithForms(['SF-30']), []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain('SF-3');
  });

  it('still matches a numbered form when the number is identical (Attachment 10 present → not missing)', () => {
    const findings = crossCheckMissingForms(
      ['Attachment 10'],
      inventoryWithForms(['Attachment 10 — Pricing Schedule']),
      [],
    );
    expect(findings).toHaveLength(0);
  });

  it('does not let an LLM finding for "Attachment 10" suppress a real "Attachment 1" cross-check', () => {
    // Same collision, second code path (llmMissingText dedup at :223).
    const llmFinding: RawFinding = {
      findingId: 'llm-1',
      targetKind: 'FORM_MISSING',
      issueType: 'MISSING_FORM',
      severity: 'critical',
      title: 'Missing Attachment 10',
      description: 'not there',
    };
    const findings = crossCheckMissingForms(['Attachment 1'], inventoryWithForms([]), [llmFinding]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain('Attachment 1');
  });

  it('suppresses a form the LLM review already flagged as missing', () => {
    const llmFinding: RawFinding = {
      findingId: 'llm-1',
      targetKind: 'FORM_MISSING',
      issueType: 'MISSING_FORM',
      severity: 'critical',
      title: 'Missing Attachment B pricing sheet',
      description: 'not there',
    };
    const findings = crossCheckMissingForms(['Attachment B'], inventoryWithForms([]), [llmFinding]);
    expect(findings).toHaveLength(0);
  });

  it('still flags a distinct missing form even when the LLM flagged a different one', () => {
    const llmFinding: RawFinding = {
      findingId: 'llm-1',
      targetKind: 'FORM_MISSING',
      issueType: 'MISSING_FORM',
      severity: 'critical',
      title: 'Missing Attachment B',
      description: 'not there',
    };
    const findings = crossCheckMissingForms(
      ['Attachment B', 'Attachment C'],
      inventoryWithForms([]),
      [llmFinding],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain('Attachment C');
  });

  it('dedups repeated expected names', () => {
    const findings = crossCheckMissingForms(
      ['Attachment A', 'attachment  a', 'ATTACHMENT A'],
      inventoryWithForms([]),
      [],
    );
    expect(findings).toHaveLength(1);
  });

  it('ignores blank/punctuation-only expected names', () => {
    const findings = crossCheckMissingForms(['', '---'], inventoryWithForms([]), []);
    expect(findings).toHaveLength(0);
  });
});

describe('getExpectedFormsFromBrief', () => {
  it('reads attachmentsAndForms from the brief', async () => {
    mockGetBrief.mockResolvedValue({
      sections: {
        requirements: {
          data: { submissionCompliance: { attachmentsAndForms: ['SF-33', ' Attachment A '] } },
        },
      },
    });
    await expect(getExpectedFormsFromBrief('p', 'o')).resolves.toEqual(['SF-33', 'Attachment A']);
  });

  it('returns [] when the brief has no attachmentsAndForms', async () => {
    mockGetBrief.mockResolvedValue({ sections: { requirements: { data: {} } } });
    await expect(getExpectedFormsFromBrief('p', 'o')).resolves.toEqual([]);
  });

  it('returns [] when no brief exists (getter throws)', async () => {
    mockGetBrief.mockRejectedValue(new Error('ExecutiveBrief not found'));
    await expect(getExpectedFormsFromBrief('p', 'o')).resolves.toEqual([]);
  });
});

describe('extractExpectedFormsFromSolicitation', () => {
  const args = { projectId: 'p', oppId: 'o', modelId: 'm' };

  it('extracts forms from a valid model response', async () => {
    mockLoadSolicitation.mockResolvedValue('The offeror must submit SF-33 and Attachment A.');
    mockInvokeModel.mockResolvedValue(modelResponse('{"forms":["SF-33","Attachment A"]}'));
    await expect(extractExpectedFormsFromSolicitation(args)).resolves.toEqual(['SF-33', 'Attachment A']);
  });

  it('returns [] when the solicitation text is empty (no model call)', async () => {
    mockLoadSolicitation.mockResolvedValue('   ');
    await expect(extractExpectedFormsFromSolicitation(args)).resolves.toEqual([]);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('threads orgId through to the Bedrock extraction call as the 3rd arg', async () => {
    mockLoadSolicitation.mockResolvedValue('The offeror must submit SF-33.');
    mockInvokeModel.mockResolvedValue(modelResponse('{"forms":["SF-33"]}'));
    await extractExpectedFormsFromSolicitation({ ...args, orgId: 'org-1' });
    expect(mockInvokeModel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'org-1');
  });

  it('returns [] and swallows a model failure', async () => {
    mockLoadSolicitation.mockResolvedValue('some text');
    mockInvokeModel.mockRejectedValue(new Error('bedrock 500'));
    await expect(extractExpectedFormsFromSolicitation(args)).resolves.toEqual([]);
  });

  it('handles a fenced / noisy JSON response', async () => {
    mockLoadSolicitation.mockResolvedValue('text');
    mockInvokeModel.mockResolvedValue(
      modelResponse('Here you go:\n```json\n{"forms":["Exhibit 1"]}\n```'),
    );
    await expect(extractExpectedFormsFromSolicitation(args)).resolves.toEqual(['Exhibit 1']);
  });
});

describe('buildExpectedForms (hybrid)', () => {
  const args = { projectId: 'p', oppId: 'o', modelId: 'm' };

  it('prefers the brief when it lists forms (no extraction call)', async () => {
    mockGetBrief.mockResolvedValue({
      sections: { requirements: { data: { submissionCompliance: { attachmentsAndForms: ['SF-33'] } } } },
    });
    await expect(buildExpectedForms(args)).resolves.toEqual(['SF-33']);
    expect(mockLoadSolicitation).not.toHaveBeenCalled();
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('falls back to fresh extraction when the brief has no forms', async () => {
    mockGetBrief.mockResolvedValue({ sections: { requirements: { data: {} } } });
    mockLoadSolicitation.mockResolvedValue('text');
    mockInvokeModel.mockResolvedValue(modelResponse('{"forms":["Attachment A"]}'));
    await expect(buildExpectedForms(args)).resolves.toEqual(['Attachment A']);
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
  });

  it('falls back to fresh extraction when no brief exists', async () => {
    mockGetBrief.mockRejectedValue(new Error('not found'));
    mockLoadSolicitation.mockResolvedValue('text');
    mockInvokeModel.mockResolvedValue(modelResponse('{"forms":["Exhibit 2"]}'));
    await expect(buildExpectedForms(args)).resolves.toEqual(['Exhibit 2']);
  });
});

describe('computeMissingFormFindings', () => {
  it('returns diff findings end-to-end (brief source)', async () => {
    mockGetBrief.mockResolvedValue({
      sections: {
        requirements: { data: { submissionCompliance: { attachmentsAndForms: ['SF-33', 'Attachment A'] } } },
      },
    });
    const findings = await computeMissingFormFindings({
      projectId: 'p',
      oppId: 'o',
      modelId: 'm',
      inventory: inventoryWithForms(['Attachment A']),
      existingFindings: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain('SF-33');
  });

  it('threads orgId through to the extraction model call', async () => {
    mockGetBrief.mockResolvedValue({ sections: { requirements: { data: {} } } });
    mockLoadSolicitation.mockResolvedValue('The offeror must submit SF-33.');
    mockInvokeModel.mockResolvedValue(modelResponse('{"forms":["SF-33"]}'));
    await computeMissingFormFindings({
      orgId: 'org-9',
      projectId: 'p',
      oppId: 'o',
      modelId: 'm',
      inventory: inventoryWithForms([]),
      existingFindings: [],
    });
    expect(mockInvokeModel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'org-9');
  });

  it('returns [] when there are no expected forms', async () => {
    mockGetBrief.mockResolvedValue({ sections: { requirements: { data: {} } } });
    mockLoadSolicitation.mockResolvedValue('');
    const findings = await computeMissingFormFindings({
      projectId: 'p',
      oppId: 'o',
      modelId: 'm',
      inventory: inventoryWithForms([]),
      existingFindings: [],
    });
    expect(findings).toEqual([]);
  });

  it('never throws — swallows an unexpected failure to []', async () => {
    mockGetBrief.mockImplementation(() => {
      throw new Error('sync boom');
    });
    mockLoadSolicitation.mockImplementation(() => {
      throw new Error('sync boom');
    });
    const findings = await computeMissingFormFindings({
      projectId: 'p',
      oppId: 'o',
      modelId: 'm',
      inventory: inventoryWithForms([]),
      existingFindings: [],
    });
    expect(findings).toEqual([]);
  });
});
