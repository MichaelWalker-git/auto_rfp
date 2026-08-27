// ─── Mocks (before imports) ───────────────────────────────────────────────────

// AWS SDK — capture UpdateCommand params for the conditional-write assertions.
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: jest.fn((params: unknown) => ({ __command: 'Update', params })),
}));

// db — mock docClient.send + isConditionalCheckFailed (a pure name check).
const mockSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  isConditionalCheckFailed: (err: unknown): boolean =>
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ConditionalCheckFailedException',
}));

// required-form — mock the write + list helpers.
const mockUpdateForm = jest.fn();
const mockListForms = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  updateRequiredForm: (...args: unknown[]) => mockUpdateForm(...args),
  listRequiredFormsByOpportunity: (...args: unknown[]) => mockListForms(...args),
}));

// opportunity — mock the read + SK builder.
const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  buildOpportunitySk: (orgId: string, projectId: string, oppId: string) => `${orgId}#${projectId}#${oppId}`,
}));

// send-notification — capture the payload + call count.
const mockSendNotification = jest.fn();
const mockBuildNotification = jest.fn((type, title, message, opts) => ({ type, title, message, ...opts }));
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  buildNotification: (...args: unknown[]) => mockBuildNotification(...(args as [unknown, unknown, unknown, Record<string, unknown>])),
}));

// org membership — the recipient fallback for legacy opportunities without
// assigneeId/createdBy.
const mockGetOrgMembers = jest.fn();
jest.mock('@/helpers/user', () => ({
  getOrgMembers: (...args: unknown[]) => mockGetOrgMembers(...args),
}));

// notary engine — mock the model call, keep the REAL merge (strongest-signal).
const mockDetect = jest.fn();
jest.mock('@/helpers/notary-detection', () => {
  const actual = jest.requireActual('@/helpers/notary-detection');
  return { __esModule: true, ...actual, detectNotaryRequirements: (...args: unknown[]) => mockDetect(...args) };
});

// name normalization + boundary containment — conservative, mirror the production helpers.
jest.mock('@/helpers/compliance-review-missing-forms', () => ({
  normalizeFormNameKey: (name: string): string =>
    name.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim(),
  containsAtWordBoundary: (haystack: string, needle: string): boolean => {
    if (!needle || needle.length > haystack.length) return false;
    for (let from = 0; ; ) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) return false;
      const beforeOk = idx === 0 || haystack[idx - 1] === ' ';
      const after = idx + needle.length;
      const afterOk = after === haystack.length || haystack[after] === ' ';
      if (beforeOk && afterOk) return true;
      from = idx + 1;
    }
  },
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';

import fc from 'fast-check';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { NotaryRequirement, NotaryStatus } from '@auto-rfp/core';
import { statusSeverity } from '@auto-rfp/core';
import {
  buildSolicitationSegments,
  buildFormPageSegments,
  mapRequirementsToForms,
  computeNotaryStatus,
  buildReviewManuallyRequirement,
  summarizeNotary,
  notarySummaryMaterialChanged,
  persistFormNotary,
  persistOpportunityNotarySummary,
  persistOpportunityUnmappedTriggers,
  rollupOpportunityNotary,
  runBodyNotaryScanAndPersist,
  scanFormPageNotary,
} from './notary-wiring';

const req = (overrides: Partial<NotaryRequirement>): NotaryRequirement => ({
  documentName: 'Doc',
  status: 'POSSIBLY_REQUIRED',
  cue: 'KEYWORD',
  pageNumber: null,
  triggeringText: 'notary',
  ...overrides,
});

const form = (formId: string, name: string, overrides: Record<string, unknown> = {}) => ({
  formId,
  name,
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('buildSolicitationSegments', () => {
  it('builds a SOLICITATION_BODY segment from docText and FORM_FIELD segments (with formId) for forms with fields', () => {
    const forms = [
      form('f1', 'Rep & Cert', { fields: [{ label: 'Company Name', value: null }, { label: 'Sign', value: 'x' }] }),
      form('f2', 'Empty PDF', { fields: [] }),
    ];
    const segments = buildSolicitationSegments('The offeror must have the form notarized.', 'solicitation.pdf', forms);

    expect(segments[0]).toMatchObject({ source: 'SOLICITATION_BODY', documentName: 'solicitation.pdf' });
    const formField = segments.find((s) => s.source === 'FORM_FIELD');
    expect(formField).toMatchObject({ formId: 'f1', documentName: 'Rep & Cert' });
    expect(formField?.text).toContain('Company Name');
    // The empty-fields form contributes no FORM_FIELD segment.
    expect(segments.filter((s) => s.source === 'FORM_FIELD')).toHaveLength(1);
  });

  it('omits the body segment when docText is empty', () => {
    const segments = buildSolicitationSegments('   ', 'solicitation.pdf', []);
    expect(segments).toHaveLength(0);
  });
});

describe('buildFormPageSegments', () => {
  it('groups LINE blocks by page and preserves the page number + formId', () => {
    const blocks = [
      { BlockType: 'LINE', Text: 'State of', Page: 2 },
      { BlockType: 'LINE', Text: 'County of', Page: 2 },
      { BlockType: 'WORD', Text: 'ignored', Page: 2 },
      { BlockType: 'LINE', Text: 'Notary Public', Page: 3 },
      { BlockType: 'LINE', Text: 'no page' },
    ];
    const segments = buildFormPageSegments(blocks, form('f1', 'Acknowledgment'));

    expect(segments).toHaveLength(2);
    const p2 = segments.find((s) => s.pageNumber === 2);
    expect(p2).toMatchObject({ source: 'FORM_PAGE', formId: 'f1', documentName: 'Acknowledgment' });
    expect(p2?.text).toBe('State of County of'); // WORD block excluded (no duplication)
    expect(segments.find((s) => s.pageNumber === 3)?.text).toBe('Notary Public');
  });

  it('returns no segments for a block list with no LINE text', () => {
    expect(buildFormPageSegments([{ BlockType: 'PAGE', Page: 1 }], form('f1', 'X'))).toHaveLength(0);
  });
});

describe('mapRequirementsToForms', () => {
  const forms = [form('f1', 'Attachment 3'), form('f2', 'Attachment 5')];

  it('maps by formId when present', () => {
    const { byFormId, unmapped } = mapRequirementsToForms([req({ formId: 'f2', documentName: 'x' })], forms);
    expect(byFormId.get('f2')).toHaveLength(1);
    expect(unmapped).toHaveLength(0);
  });

  it('maps by conservative name normalization when no formId', () => {
    const { byFormId } = mapRequirementsToForms([req({ documentName: 'attachment 3' })], forms);
    expect(byFormId.get('f1')).toHaveLength(1);
    // Does NOT collide "Attachment 3" with "Attachment 5".
    expect(byFormId.has('f2')).toBe(false);
  });

  it('retains a generic solicitation-body hit as unmapped', () => {
    const { byFormId, unmapped } = mapRequirementsToForms([req({ documentName: 'solicitation.pdf' })], forms);
    expect(byFormId.size).toBe(0);
    expect(unmapped).toHaveLength(1);
  });

  it('maps a body hit whose triggeringText names a specific form (mention tier)', () => {
    const named = [form('f1', 'SF-1413.pdf'), form('f2', 'Pricing Sheet.xlsx')];
    const { byFormId, unmapped } = mapRequirementsToForms(
      [req({ documentName: 'solicitation.pdf', triggeringText: 'Form SF-1413 must be notarized prior to award.' })],
      named,
    );
    expect(byFormId.get('f1')).toHaveLength(1);
    // The mapped clone carries the formId so the merge groups it under the form.
    expect(byFormId.get('f1')?.[0]).toMatchObject({ formId: 'f1' });
    expect(byFormId.has('f2')).toBe(false);
    expect(unmapped).toHaveLength(0);
  });

  it('maps a clause naming several forms to EACH of them', () => {
    const named = [form('f1', 'Non-Collusion Affidavit'), form('f2', 'Bid Bond Form 24')];
    const { byFormId, unmapped } = mapRequirementsToForms(
      [req({
        documentName: 'solicitation.pdf',
        triggeringText: 'The Non-Collusion Affidavit and Bid Bond Form 24 shall each be notarized.',
      })],
      named,
    );
    expect(byFormId.get('f1')).toHaveLength(1);
    expect(byFormId.get('f2')).toHaveLength(1);
    expect(unmapped).toHaveLength(0);
  });

  it('keeps a truly generic clause ("all forms must be notarized") unmapped', () => {
    const named = [form('f1', 'SF-1413.pdf')];
    const { byFormId, unmapped } = mapRequirementsToForms(
      [req({ documentName: 'solicitation.pdf', triggeringText: 'All forms and affidavits must be notarized.' })],
      named,
    );
    expect(byFormId.size).toBe(0);
    expect(unmapped).toHaveLength(1);
  });

  it('never mention-maps a purely generic short form name', () => {
    const named = [form('f1', 'Form')];
    const { byFormId, unmapped } = mapRequirementsToForms(
      [req({ documentName: 'solicitation.pdf', triggeringText: 'This form must be notarized.' })],
      named,
    );
    expect(byFormId.size).toBe(0);
    expect(unmapped).toHaveLength(1);
  });

  it('does not mention-match "Attachment 1" inside "Attachment 10" text (word boundary)', () => {
    const named = [form('f1', 'Attachment 1')];
    const { byFormId, unmapped } = mapRequirementsToForms(
      [req({ documentName: 'solicitation.pdf', triggeringText: 'Attachment 10 must be notarized.' })],
      named,
    );
    expect(byFormId.size).toBe(0);
    expect(unmapped).toHaveLength(1);
  });

  it('mention-matches across punctuation variants ("SF 1413" text vs "SF-1413.pdf" name)', () => {
    const named = [form('f1', 'SF-1413.pdf')];
    const { byFormId, unmapped } = mapRequirementsToForms(
      [req({ documentName: 'solicitation.pdf', triggeringText: 'Submit a notarized SF 1413 with your offer.' })],
      named,
    );
    expect(byFormId.get('f1')).toHaveLength(1);
    expect(unmapped).toHaveLength(0);
  });
});

describe('computeNotaryStatus', () => {
  it('returns NOT_REQUIRED for an empty set', () => {
    expect(computeNotaryStatus([])).toBe('NOT_REQUIRED');
  });

  it('returns the strongest signal (a weaker entry never downgrades)', () => {
    expect(
      computeNotaryStatus([req({ status: 'NOT_REQUIRED' }), req({ status: 'REQUIRED' }), req({ status: 'POSSIBLY_REQUIRED' })]),
    ).toBe('REQUIRED');
  });

  it('property: result severity is the max over all requirements', () => {
    const statusArb = fc.constantFrom<NotaryStatus>('REQUIRED', 'POSSIBLY_REQUIRED', 'NOT_REQUIRED');
    fc.assert(
      fc.property(fc.array(statusArb), (statuses) => {
        const result = computeNotaryStatus(statuses.map((s) => req({ status: s })));
        const maxSeverity = statuses.reduce((m, s) => Math.max(m, statusSeverity(s)), statusSeverity('NOT_REQUIRED'));
        return statusSeverity(result) === maxSeverity;
      }),
    );
  });
});

describe('buildReviewManuallyRequirement', () => {
  it('is POSSIBLY_REQUIRED and carries the formId when supplied', () => {
    const r = buildReviewManuallyRequirement('Form A', 'f1');
    expect(r.status).toBe('POSSIBLY_REQUIRED');
    expect(r.formId).toBe('f1');
    expect(r.triggeringText).toMatch(/review manually/i);
  });
});

describe('summarizeNotary', () => {
  it('counts FORM statuses only — unmapped triggers never inflate the counts', () => {
    const forms = [
      form('f1', 'A', { notaryStatus: 'REQUIRED' }),
      form('f2', 'B', { notaryStatus: 'POSSIBLY_REQUIRED' }),
      form('f3', 'C', { notaryStatus: 'NOT_REQUIRED' }),
    ];
    const summary = summarizeNotary(forms, [req({ status: 'POSSIBLY_REQUIRED' })]);
    expect(summary).toMatchObject({
      anyNotaryRequired: true,
      requiredCount: 1,
      possiblyRequiredCount: 1, // forms only — the unmapped trigger is not a form
      totalFormsConsidered: 3,
    });
  });

  it('flagged counts can never exceed totalFormsConsidered ("23 of 16" regression)', () => {
    const forms = [
      form('f1', 'A', { notaryStatus: 'REQUIRED' }),
      form('f2', 'B', { notaryStatus: 'NOT_REQUIRED' }),
    ];
    const manyTriggers = Array.from({ length: 20 }, (_, i) =>
      req({ status: 'REQUIRED', triggeringText: `clause ${i}` }),
    );
    const summary = summarizeNotary(forms, manyTriggers);
    expect(summary.requiredCount + summary.possiblyRequiredCount).toBeLessThanOrEqual(
      summary.totalFormsConsidered,
    );
    expect(summary).toMatchObject({ requiredCount: 1, possiblyRequiredCount: 0, totalFormsConsidered: 2 });
  });

  it('unmapped triggers alone still flag the opportunity (anyNotaryRequired) with zero form counts', () => {
    const forms = [form('f1', 'A', { notaryStatus: 'NOT_REQUIRED' })];
    const summary = summarizeNotary(forms, [req({ status: 'REQUIRED' })]);
    expect(summary).toMatchObject({
      anyNotaryRequired: true,
      requiredCount: 0,
      possiblyRequiredCount: 0,
      totalFormsConsidered: 1,
    });
  });

  it('a NOT_REQUIRED unmapped trigger does not flag the opportunity', () => {
    const summary = summarizeNotary(
      [form('f1', 'A', { notaryStatus: 'NOT_REQUIRED' })],
      [req({ status: 'NOT_REQUIRED' })],
    );
    expect(summary.anyNotaryRequired).toBe(false);
  });

  it('is clean when nothing is required', () => {
    const summary = summarizeNotary([form('f1', 'A', { notaryStatus: 'NOT_REQUIRED' })], []);
    expect(summary.anyNotaryRequired).toBe(false);
    expect(summary.requiredCount).toBe(0);
    expect(summary.possiblyRequiredCount).toBe(0);
  });
});

describe('notarySummaryMaterialChanged', () => {
  const base = { anyNotaryRequired: true, requiredCount: 1, possiblyRequiredCount: 1, totalFormsConsidered: 5, computedAt: 'a' };

  it('treats a missing prior summary as changed', () => {
    expect(notarySummaryMaterialChanged(null, base)).toBe(true);
  });

  it('fires on a required/possibly count change', () => {
    expect(notarySummaryMaterialChanged({ ...base, requiredCount: 0 }, base)).toBe(true);
  });

  it('is silent on a totalFormsConsidered-only change (non-notary form added)', () => {
    expect(notarySummaryMaterialChanged({ ...base, totalFormsConsidered: 4, computedAt: 'b' }, base)).toBe(false);
  });

  it('is silent when the material fields are identical', () => {
    expect(notarySummaryMaterialChanged({ ...base }, base)).toBe(false);
  });
});

// ─── persistFormNotary (WF-C atomic conditional write) ────────────────────────

describe('persistFormNotary', () => {
  it('merges existing + incoming (no downgrade) and writes guarded on AI_DETECTED', async () => {
    mockUpdateForm.mockResolvedValueOnce({});
    await persistFormNotary({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'f1',
      existing: [req({ formId: 'f1', status: 'REQUIRED', triggeringText: 'ack block' })],
      incoming: [req({ formId: 'f1', status: 'NOT_REQUIRED', triggeringText: 'out of state' })],
    });

    expect(mockUpdateForm).toHaveBeenCalledTimes(1);
    const arg = mockUpdateForm.mock.calls[0][0];
    expect(arg.guardNotaryAiDetected).toBe(true);
    expect(arg.patch.notarySource).toBe('AI_DETECTED');
    // Strongest-signal merge: REQUIRED wins, never downgraded to NOT_REQUIRED.
    expect(arg.patch.notaryStatus).toBe('REQUIRED');
  });

  it('swallows a USER_SET conditional-check rejection (override preserved, no throw)', async () => {
    mockUpdateForm.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    await expect(
      persistFormNotary({
        orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'f1',
        existing: [], incoming: [req({ formId: 'f1', status: 'REQUIRED' })],
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows a non-conditional write error (best-effort, no throw)', async () => {
    mockUpdateForm.mockRejectedValueOnce(new Error('throttled'));
    await expect(
      persistFormNotary({
        orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'f1',
        existing: [], incoming: [req({ formId: 'f1', status: 'REQUIRED' })],
      }),
    ).resolves.toBeUndefined();
  });
});

// ─── persistOpportunityNotarySummary (WF-D atomic conditional write) ──────────

describe('persistOpportunityNotarySummary', () => {
  const summary = { anyNotaryRequired: true, requiredCount: 1, possiblyRequiredCount: 0, totalFormsConsidered: 3, computedAt: 'a' };

  it('writes with the AI_DETECTED guard and returns true on success', async () => {
    mockSend.mockResolvedValueOnce({});
    const ok = await persistOpportunityNotarySummary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', summary });
    expect(ok).toBe(true);
    expect(UpdateCommand).toHaveBeenCalledTimes(1);
    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(params.ConditionExpression).toContain('#nss');
    expect(params.ConditionExpression).toContain(':ai');
    expect(params.ExpressionAttributeNames['#nss']).toBe('notarySummarySource');
    expect(params.ExpressionAttributeValues[':ai']).toBe('AI_DETECTED');
    expect(params.ExpressionAttributeValues[':summary']).toEqual(summary);
  });

  it('returns false (skip) when the USER_SET guard rejects the write', async () => {
    mockSend.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    const ok = await persistOpportunityNotarySummary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', summary });
    expect(ok).toBe(false);
  });

  it('returns false (best-effort) on a non-conditional error', async () => {
    mockSend.mockRejectedValueOnce(new Error('service down'));
    const ok = await persistOpportunityNotarySummary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', summary });
    expect(ok).toBe(false);
  });

  it('guards on "no stored summary" when expectedPrior is null', async () => {
    mockSend.mockResolvedValueOnce({});
    await persistOpportunityNotarySummary({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', summary, expectedPrior: null,
    });
    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(params.ConditionExpression).toContain('attribute_not_exists(#ns)');
  });

  it('guards on the exact prior summary when expectedPrior is a value', async () => {
    const priorSummary = { ...summary, computedAt: 'earlier' };
    mockSend.mockResolvedValueOnce({});
    await persistOpportunityNotarySummary({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', summary, expectedPrior: priorSummary,
    });
    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(params.ConditionExpression).toContain('#ns = :prior');
    expect(params.ExpressionAttributeValues[':prior']).toEqual(priorSummary);
  });

  it('applies no prior guard when expectedPrior is undefined (degraded path)', async () => {
    mockSend.mockResolvedValueOnce({});
    await persistOpportunityNotarySummary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', summary });
    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(params.ConditionExpression).not.toContain('#ns =');
    expect(params.ConditionExpression).not.toContain('attribute_not_exists(#ns)');
  });
});

// ─── persistOpportunityUnmappedTriggers (BR10.3 durable opportunity-level store) ─

describe('persistOpportunityUnmappedTriggers', () => {
  it('merges with the stored triggers and writes guarded on AI_DETECTED', async () => {
    // Prior store already holds one trigger; a second body scan adds a distinct one.
    mockGetOpportunity.mockResolvedValueOnce({
      item: { notaryUnmappedTriggers: [req({ documentName: 'sol.pdf', triggeringText: 'first mention' })] },
    });
    mockSend.mockResolvedValueOnce({});

    await persistOpportunityUnmappedTriggers({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1',
      triggers: [req({ documentName: 'sol.pdf', triggeringText: 'second mention' })],
    });

    expect(UpdateCommand).toHaveBeenCalledTimes(1);
    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(params.ExpressionAttributeNames['#nut']).toBe('notaryUnmappedTriggers');
    // USER_SET guard on the summary source, same as the summary write.
    expect(params.ConditionExpression).toContain('#nss');
    expect(params.ExpressionAttributeValues[':ai']).toBe('AI_DETECTED');
    // Union of prior + new, deduped by natural key → both distinct triggers kept.
    expect(params.ExpressionAttributeValues[':triggers']).toHaveLength(2);
  });

  it('is a no-op when there are no triggers to persist', async () => {
    await persistOpportunityUnmappedTriggers({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', triggers: [] });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('swallows a USER_SET conditional-check rejection (no throw)', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: {} });
    mockSend.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    await expect(
      persistOpportunityUnmappedTriggers({
        orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', triggers: [req({})],
      }),
    ).resolves.toBeUndefined();
  });

  it('still writes the current triggers when the opportunity read fails (best-effort, no throw)', async () => {
    mockGetOpportunity.mockRejectedValueOnce(new Error('read failed'));
    mockSend.mockResolvedValueOnce({});
    await expect(
      persistOpportunityUnmappedTriggers({
        orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', triggers: [req({ triggeringText: 'notarize' })],
      }),
    ).resolves.toBeUndefined();
    expect(UpdateCommand).toHaveBeenCalledTimes(1);
    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(params.ExpressionAttributeValues[':triggers']).toHaveLength(1);
    // Degraded path: no lost-update guard (we have no prior value to condition on).
    expect(params.ConditionExpression).not.toContain('#nut = :prev');
  });

  it('conditions the write on the exact stored triggers it merged from (lost-update guard)', async () => {
    const prior = [req({ triggeringText: 'first mention' })];
    mockGetOpportunity.mockResolvedValueOnce({ item: { notaryUnmappedTriggers: prior } });
    mockSend.mockResolvedValueOnce({});

    await persistOpportunityUnmappedTriggers({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1',
      triggers: [req({ triggeringText: 'second mention' })],
    });

    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(params.ConditionExpression).toContain('#nut = :prev');
    expect(params.ExpressionAttributeValues[':prev']).toEqual(prior);
  });

  it('re-reads and re-merges when a concurrent writer changes the store mid-flight (no dropped trigger)', async () => {
    // Attempt 1: store is empty; a concurrent body scan writes "theirs" between
    // our read and our write, so the conditional write fails.
    mockGetOpportunity.mockResolvedValueOnce({ item: {} });
    mockSend.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    // Attempt 2: re-read sees the concurrent writer's trigger; write succeeds.
    const theirs = req({ triggeringText: 'their trigger' });
    mockGetOpportunity.mockResolvedValueOnce({ item: { notaryUnmappedTriggers: [theirs] } });
    mockSend.mockResolvedValueOnce({});

    await persistOpportunityUnmappedTriggers({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1',
      triggers: [req({ triggeringText: 'our trigger' })],
    });

    expect(UpdateCommand).toHaveBeenCalledTimes(2);
    const finalWrite = (UpdateCommand as unknown as jest.Mock).mock.calls[1][0];
    // The union survives — the concurrent writer's evidence is never overwritten.
    expect(finalWrite.ExpressionAttributeValues[':triggers']).toHaveLength(2);
    expect(finalWrite.ExpressionAttributeValues[':prev']).toEqual([theirs]);
  });

  it('skips the write entirely when the store already holds every incoming trigger (converged)', async () => {
    const trigger = req({ triggeringText: 'already stored' });
    mockGetOpportunity.mockResolvedValueOnce({ item: { notaryUnmappedTriggers: [trigger] } });

    await persistOpportunityUnmappedTriggers({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', triggers: [trigger],
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('skips the write when the read shows the summary is USER_SET', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummarySource: 'USER_SET' } });

    await persistOpportunityUnmappedTriggers({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', triggers: [req({})],
    });

    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ─── rollupOpportunityNotary (WF-D notification change-guard) ─────────────────

describe('rollupOpportunityNotary', () => {
  const forms = [form('f1', 'A', { notaryStatus: 'REQUIRED' }), form('f2', 'B', { notaryStatus: 'NOT_REQUIRED' })];

  it('notifies exactly once on a false→true transition, to deduped recipients', async () => {
    mockGetOpportunity.mockResolvedValueOnce({
      item: { notarySummary: null, assigneeId: 'user-a', createdBy: 'user-b' },
    });
    mockSend.mockResolvedValueOnce({}); // persist succeeds

    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const payload = mockSendNotification.mock.calls[0][0];
    expect(payload.type).toBe('NOTARY_REQUIRED');
    expect(payload.recipientUserIds).toEqual(['user-a', 'user-b']);
    expect(payload.entityId).toBe('opp-1');
    // Per-form counts: 1 flagged of 2 forms — never more flagged than forms.
    expect(payload.message).toBe(
      '1 of 2 form(s) in this opportunity may require notarization. Review before submission.',
    );
  });

  it('uses solicitation-level wording when only unmapped triggers flag the opportunity', async () => {
    const cleanForms = [form('f1', 'A', { notaryStatus: 'NOT_REQUIRED' })];
    mockGetOpportunity.mockResolvedValueOnce({
      item: { notarySummary: null, assigneeId: 'user-a', createdBy: 'user-b' },
    });
    mockSend.mockResolvedValueOnce({}); // persist succeeds

    await rollupOpportunityNotary({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      forms: cleanForms,
      unmappedTriggers: [req({ status: 'REQUIRED', triggeringText: 'all bids must be notarized' })],
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const payload = mockSendNotification.mock.calls[0][0];
    // Never "0 of 1 form(s)" — the flag came from the solicitation body.
    expect(payload.message).toBe(
      'The solicitation for this opportunity contains notarization requirements. Review before submission.',
    );
  });

  it('dedupes recipients when assignee === createdBy', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: null, assigneeId: 'user-a', createdBy: 'user-a' } });
    mockSend.mockResolvedValueOnce({});
    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });
    expect(mockSendNotification.mock.calls[0][0].recipientUserIds).toEqual(['user-a']);
  });

  it('falls back to org members for a LEGACY opportunity with no assignee and no createdBy', async () => {
    // Old records (pre-createdBy) carry neither field; the notification must
    // not be silently skipped — it goes to the org membership instead.
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: null } });
    mockSend.mockResolvedValueOnce({}); // persist succeeds
    mockGetOrgMembers.mockResolvedValueOnce([
      { userId: 'member-1', email: 'a@x.test' },
      { userId: 'member-2', email: 'b@x.test' },
    ]);

    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });

    expect(mockGetOrgMembers).toHaveBeenCalledWith('org-1');
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0][0].recipientUserIds).toEqual(['member-1', 'member-2']);
  });

  it('does not consult org members when the opportunity has an owner', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: null, createdBy: 'user-b' } });
    mockSend.mockResolvedValueOnce({});
    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });
    expect(mockGetOrgMembers).not.toHaveBeenCalled();
    expect(mockSendNotification.mock.calls[0][0].recipientUserIds).toEqual(['user-b']);
  });

  it('suppresses the notification (but still persists the summary) when notify=false', async () => {
    // The manual-override handler recomputes the rollup after a user edit —
    // notifying the org about the user's own click would be noise.
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: null, createdBy: 'user-b' } });
    mockSend.mockResolvedValueOnce({}); // persist succeeds

    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms, notify: false });

    // Summary persisted…
    expect(mockSend).toHaveBeenCalledTimes(1);
    // …but no notification, despite a false→true material change.
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('never throws when the org-members fallback fails — it just skips the send', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: null } });
    mockSend.mockResolvedValueOnce({});
    mockGetOrgMembers.mockRejectedValueOnce(new Error('query failed'));

    await expect(
      rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms }),
    ).resolves.toBeUndefined();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('is silent when the notary result is unchanged', async () => {
    mockGetOpportunity.mockResolvedValueOnce({
      item: {
        notarySummary: { anyNotaryRequired: true, requiredCount: 1, possiblyRequiredCount: 0, totalFormsConsidered: 2, computedAt: 'old' },
        assigneeId: 'user-a', createdBy: 'user-b',
      },
    });
    mockSend.mockResolvedValueOnce({});
    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('is silent on a totalFormsConsidered-only change (non-notary form added)', async () => {
    // Prior: same notary counts, different totalFormsConsidered.
    mockGetOpportunity.mockResolvedValueOnce({
      item: {
        notarySummary: { anyNotaryRequired: true, requiredCount: 1, possiblyRequiredCount: 0, totalFormsConsidered: 99, computedAt: 'old' },
        assigneeId: 'user-a', createdBy: 'user-b',
      },
    });
    mockSend.mockResolvedValueOnce({});
    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('does NOT notify when the summary write was rejected by a USER_SET guard', async () => {
    // A user takes manual control between our read and write: the guarded write
    // is rejected, and the retry's re-read sees USER_SET and stops cleanly.
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: null, assigneeId: 'user-a', createdBy: 'user-b' } });
    mockSend.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' }); // persist rejected
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummarySource: 'USER_SET' } });
    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1); // no second write once USER_SET is seen
  });

  it('skips the write entirely when the summary is already USER_SET on read', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummarySource: 'USER_SET' } });
    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('does NOT double-notify when a concurrent rollup wins the race (BR11.2 dedup)', async () => {
    // Attempt 1: we read prior=null; a concurrent rollup persists the same
    // material summary between our read and write → our guarded write fails.
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: null, assigneeId: 'user-a' } });
    mockSend.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });
    // Attempt 2: re-read sees the winner's summary — materially identical to ours.
    const winners = { anyNotaryRequired: true, requiredCount: 1, possiblyRequiredCount: 0, totalFormsConsidered: 2, computedAt: 'winner' };
    mockGetOpportunity.mockResolvedValueOnce({ item: { notarySummary: winners, assigneeId: 'user-a' } });
    mockSend.mockResolvedValueOnce({}); // guarded re-persist succeeds

    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms });

    // The winner notified; the material-change guard suppresses our duplicate.
    expect(mockSendNotification).not.toHaveBeenCalled();
    // The retry's write was guarded on the winner's summary, not on null.
    const retryWrite = (UpdateCommand as unknown as jest.Mock).mock.calls[1][0];
    expect(retryWrite.ConditionExpression).toContain('#ns = :prior');
    expect(retryWrite.ExpressionAttributeValues[':prior']).toEqual(winners);
  });

  it('never throws when the opportunity read fails', async () => {
    mockGetOpportunity.mockRejectedValueOnce(new Error('read failed'));
    mockSend.mockResolvedValueOnce({});
    await expect(
      rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms }),
    ).resolves.toBeUndefined();
  });

  // ── BR10.3 zero-miss: the mixed-opportunity fix ──────────────────────────────
  //
  // Mixed opportunity: the body scan persisted a generic unmapped trigger while a
  // PDF form was still pending, so its markFormsReadyIfAllDone returned early (no
  // rollup). Later the last PDF completes and the Textract callback fires the rollup
  // with NO passed-in triggers. The generic mention must still be folded in — it is
  // read from the persisted opportunity store, not from the (empty) argument.
  it('folds a PERSISTED unmapped trigger into the summary even when no triggers are passed in', async () => {
    const cleanForms = [form('f1', 'Inline DOCX', { notaryStatus: 'NOT_REQUIRED' })];
    mockGetOpportunity.mockResolvedValueOnce({
      item: {
        notarySummary: null,
        assigneeId: 'user-a',
        createdBy: 'user-b',
        // Persisted at body-scan time; survives the async gap to this final rollup.
        notaryUnmappedTriggers: [
          req({ status: 'POSSIBLY_REQUIRED', documentName: 'solicitation.pdf', triggeringText: 'all certifications must be notarized' }),
        ],
      },
    });
    mockSend.mockResolvedValueOnce({}); // summary persist succeeds

    // NOTE: no `unmappedTriggers` argument — the Textract-callback path passes none.
    await rollupOpportunityNotary({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', forms: cleanForms });

    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    const persistedSummary = params.ExpressionAttributeValues[':summary'];
    // The generic mention is NOT dropped: the summary reflects it via
    // anyNotaryRequired — but it is not a form, so the per-form counts stay 0.
    expect(persistedSummary.anyNotaryRequired).toBe(true);
    expect(persistedSummary.possiblyRequiredCount).toBe(0);
    // Triggers are not forms — the denominator counts forms only.
    expect(persistedSummary.totalFormsConsidered).toBe(1);
    // And the false→true transition notifies once, with solicitation wording.
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0][0].message).toMatch(/solicitation/i);
  });

  it('duplicate triggers (persisted store + passed-in set) never inflate the per-form counts', async () => {
    const dup = req({ status: 'POSSIBLY_REQUIRED', documentName: 'solicitation.pdf', triggeringText: 'notarize all forms' });
    mockGetOpportunity.mockResolvedValueOnce({
      item: { notarySummary: null, assigneeId: 'user-a', createdBy: 'user-b', notaryUnmappedTriggers: [dup] },
    });
    mockSend.mockResolvedValueOnce({});

    await rollupOpportunityNotary({
      orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1',
      forms: [form('f1', 'A', { notaryStatus: 'NOT_REQUIRED' })],
      unmappedTriggers: [dup],
    });

    const params = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
    const persistedSummary = params.ExpressionAttributeValues[':summary'];
    // Triggers flag the opportunity but are never counted as forms — once or duplicated.
    expect(persistedSummary.anyNotaryRequired).toBe(true);
    expect(persistedSummary.possiblyRequiredCount).toBe(0);
  });
});

// ─── runBodyNotaryScanAndPersist (WF-A) ───────────────────────────────────────

describe('runBodyNotaryScanAndPersist', () => {
  it('persists mapped-form notary state and returns unmapped triggers', async () => {
    mockListForms.mockResolvedValueOnce([form('f1', 'Rep & Cert', { notaryRequirements: [] })]);
    mockDetect.mockResolvedValueOnce([
      req({ formId: 'f1', status: 'REQUIRED', documentName: 'Rep & Cert' }),
      req({ status: 'POSSIBLY_REQUIRED', documentName: 'solicitation.pdf' }), // unmapped
    ]);
    mockUpdateForm.mockResolvedValue({});

    const unmapped = await runBodyNotaryScanAndPersist({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1',
      docText: 'must be notarized', solicitationDocName: 'solicitation.pdf', truncated: false,
    });

    expect(mockUpdateForm).toHaveBeenCalledTimes(1);
    expect(mockUpdateForm.mock.calls[0][0].patch.notaryStatus).toBe('REQUIRED');
    expect(unmapped).toHaveLength(1);
  });

  it('signals truncation to the engine when the detection scan was capped', async () => {
    mockListForms.mockResolvedValueOnce([form('f1', 'A', { notaryRequirements: [] })]);
    mockDetect.mockResolvedValueOnce([]);
    await runBodyNotaryScanAndPersist({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1',
      docText: 'text', solicitationDocName: 'big.pdf', truncated: true,
    });
    expect(mockDetect).toHaveBeenCalledWith(expect.objectContaining({ truncatedDocuments: ['big.pdf'] }));
  });

  it('a genuinely empty scan leaves NOT_REQUIRED (no fallback write)', async () => {
    mockListForms.mockResolvedValueOnce([form('f1', 'A', { notaryRequirements: [] })]);
    mockDetect.mockResolvedValueOnce([]); // no candidates
    const unmapped = await runBodyNotaryScanAndPersist({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1',
      docText: 'nothing here', solicitationDocName: 'x.pdf', truncated: false,
    });
    expect(mockUpdateForm).not.toHaveBeenCalled();
    expect(unmapped).toEqual([]);
  });

  it('a u2-side scan failure marks every scanned form POSSIBLY_REQUIRED review-manually (never silent NOT_REQUIRED)', async () => {
    mockListForms.mockResolvedValueOnce([form('f1', 'A', { notaryRequirements: [] }), form('f2', 'B', { notaryRequirements: [] })]);
    mockDetect.mockRejectedValueOnce(new Error('engine wiring blew up'));
    mockUpdateForm.mockResolvedValue({});

    const unmapped = await runBodyNotaryScanAndPersist({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1',
      docText: 'text', solicitationDocName: 'x.pdf', truncated: false,
    });

    expect(mockUpdateForm).toHaveBeenCalledTimes(2);
    for (const call of mockUpdateForm.mock.calls) {
      expect(call[0].patch.notaryStatus).toBe('POSSIBLY_REQUIRED');
    }
    expect(unmapped).toEqual([]);
  });

  it('never throws when listing forms fails', async () => {
    mockListForms.mockRejectedValueOnce(new Error('list failed'));
    await expect(
      runBodyNotaryScanAndPersist({
        orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1',
        docText: 'text', solicitationDocName: 'x.pdf', truncated: false,
      }),
    ).resolves.toEqual([]);
  });
});

// ─── scanFormPageNotary (WF-B) ────────────────────────────────────────────────

describe('scanFormPageNotary', () => {
  it('returns the merged status from the engine result', async () => {
    mockDetect.mockResolvedValueOnce([req({ formId: 'f1', status: 'REQUIRED', pageNumber: 2 })]);
    const patch = await scanFormPageNotary({
      orgId: 'org-1',
      form: form('f1', 'Ack', { notaryRequirements: [] }),
      blocks: [{ BlockType: 'LINE', Text: 'notary public', Page: 2 }],
    });
    expect(patch.notaryStatus).toBe('REQUIRED');
    expect(patch.notarySource).toBe('AI_DETECTED');
    expect(patch.notaryRequirements.length).toBeGreaterThan(0);
  });

  it('fails open to POSSIBLY_REQUIRED review-manually on a scan error (never NOT_REQUIRED)', async () => {
    mockDetect.mockRejectedValueOnce(new Error('scan blew up'));
    const patch = await scanFormPageNotary({
      orgId: 'org-1',
      form: form('f1', 'Ack', { notaryRequirements: [] }),
      blocks: [{ BlockType: 'LINE', Text: 'notary public', Page: 2 }],
    });
    expect(patch.notaryStatus).toBe('POSSIBLY_REQUIRED');
    expect(patch.notaryRequirements[0].triggeringText).toMatch(/review manually/i);
  });

  it('does not downgrade an existing REQUIRED when the new scan is clean', async () => {
    mockDetect.mockResolvedValueOnce([]); // clean page scan
    const patch = await scanFormPageNotary({
      orgId: 'org-1',
      form: form('f1', 'Ack', { notaryRequirements: [req({ formId: 'f1', status: 'REQUIRED' })] }),
      blocks: [],
    });
    expect(patch.notaryStatus).toBe('REQUIRED');
  });
});
