/**
 * Tests for the Solution Plan DB/S3 helper (T5).
 * Mocks the db layer and s3 helpers so we can assert what each helper
 * passes through — including the markSolutionPlanStale READY-only guard.
 */
const mockCreateItem = jest.fn();
const mockGetItem = jest.fn();
const mockPutItem = jest.fn();
const mockUpdateItem = jest.fn();
const mockQueryAllBySkPrefix = jest.fn();
const mockDeleteAllBySkPrefix = jest.fn();

jest.mock('@/helpers/db', () => ({
  createItem: (...a: unknown[]) => mockCreateItem(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  putItem: (...a: unknown[]) => mockPutItem(...a),
  updateItem: (...a: unknown[]) => mockUpdateItem(...a),
  queryAllBySkPrefix: (...a: unknown[]) => mockQueryAllBySkPrefix(...a),
  deleteAllBySkPrefix: (...a: unknown[]) => mockDeleteAllBySkPrefix(...a),
  docClient: { send: jest.fn() },
}));

const mockUploadToS3 = jest.fn();
const mockLoadTextFromS3 = jest.fn();

jest.mock('@/helpers/s3', () => ({
  uploadToS3: (...a: unknown[]) => mockUploadToS3(...a),
  loadTextFromS3: (...a: unknown[]) => mockLoadTextFromS3(...a),
}));

import {
  appendGrillingMessage,
  buildGrillingMessageSk,
  buildGrillingMessageSkPrefix,
  buildSolutionPlanHtmlKey,
  buildSolutionPlanSk,
  deleteGrillingMessages,
  getSolutionPlanByOpportunity,
  listGrillingMessages,
  loadSolutionPlanHtml,
  markSolutionPlanStale,
  padGrillingRound,
  putSolutionPlan,
  updateSolutionPlanStatus,
  uploadSolutionPlanHtml,
} from './solution-plan';
import { GRILLING_MESSAGE_PK, SOLUTION_PLAN_PK } from '../constants/solution-plan';
import type { SolutionPlanItem } from '@auto-rfp/core';

const basePlan: SolutionPlanItem = {
  id: 'plan-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  status: 'GRILLING',
  isStale: false,
  runId: 'run-1',
  version: 0,
  isUserEdited: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateItem.mockImplementation((_pk, _sk, item) => Promise.resolve(item));
  mockPutItem.mockImplementation((_pk, _sk, item) => Promise.resolve(item));
  mockUpdateItem.mockImplementation((_pk, _sk, updates) => Promise.resolve(updates));
});

// ─── SK builders ────────────────────────────────────────────────────────────────

describe('SK builders', () => {
  it('builds the plan SK as {orgId}#{projectId}#{opportunityId}', () => {
    expect(buildSolutionPlanSk('org-1', 'proj-1', 'opp-1')).toBe('org-1#proj-1#opp-1');
  });

  it('zero-pads round numbers to 3 digits', () => {
    expect(padGrillingRound(1)).toBe('001');
    expect(padGrillingRound(42)).toBe('042');
    expect(padGrillingRound(123)).toBe('123');
  });

  it('builds the message SK as {planId}#{round:3pad}#{ts}#{messageId}', () => {
    expect(buildGrillingMessageSk('plan-1', 2, '2026-08-11T00:00:00.000Z', 'msg-1')).toBe(
      'plan-1#002#2026-08-11T00:00:00.000Z#msg-1',
    );
  });

  it('message SKs sort by round lexicographically thanks to padding', () => {
    const round2 = buildGrillingMessageSk('plan-1', 2, '2026-08-11T00:00:00.000Z', 'a');
    const round10 = buildGrillingMessageSk('plan-1', 10, '2026-08-11T00:00:00.000Z', 'b');
    expect(round2 < round10).toBe(true);
  });

  it('builds the message SK prefix from the plan id', () => {
    expect(buildGrillingMessageSkPrefix('plan-1')).toBe('plan-1#');
  });
});

// ─── Plan CRUD ──────────────────────────────────────────────────────────────────

describe('getSolutionPlanByOpportunity', () => {
  it('reads with the SOLUTION_PLAN PK and the deterministic plan SK', async () => {
    mockGetItem.mockResolvedValue(basePlan);
    const plan = await getSolutionPlanByOpportunity('org-1', 'proj-1', 'opp-1');
    expect(mockGetItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, 'org-1#proj-1#opp-1');
    expect(plan).toEqual(basePlan);
  });

  it('returns null when no plan exists', async () => {
    mockGetItem.mockResolvedValue(null);
    await expect(getSolutionPlanByOpportunity('org-1', 'proj-1', 'opp-1')).resolves.toBeNull();
  });
});

describe('putSolutionPlan', () => {
  it('upserts with the SK derived from the plan identifiers', async () => {
    await putSolutionPlan(basePlan);
    expect(mockPutItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, 'org-1#proj-1#opp-1', basePlan);
  });
});

describe('updateSolutionPlanStatus', () => {
  it('sets status and merges the optional patch', async () => {
    await updateSolutionPlanStatus({
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      status: 'READY',
      patch: { contentKey: 'some/key.html', version: 3 },
    });
    expect(mockUpdateItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, 'org-1#proj-1#opp-1', {
      status: 'READY',
      contentKey: 'some/key.html',
      version: 3,
    });
  });

  it('works without a patch', async () => {
    await updateSolutionPlanStatus({
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      status: 'GENERATING_SOT',
    });
    expect(mockUpdateItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, 'org-1#proj-1#opp-1', {
      status: 'GENERATING_SOT',
    });
  });
});

// ─── markSolutionPlanStale (ADR-3 guard) ────────────────────────────────────────

describe('markSolutionPlanStale', () => {
  const args = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', reason: 'Exec brief regenerated' };

  it('sets isStale + staleReason with a READY-only condition', async () => {
    const updated = { ...basePlan, status: 'READY', isStale: true, staleReason: args.reason };
    mockUpdateItem.mockResolvedValue(updated);

    const result = await markSolutionPlanStale(args);

    expect(mockUpdateItem).toHaveBeenCalledWith(
      SOLUTION_PLAN_PK,
      'org-1#proj-1#opp-1',
      { isStale: true, staleReason: args.reason },
      expect.objectContaining({
        condition: expect.stringContaining('#status = :readyStatus'),
        conditionNames: { '#pk': 'partition_key', '#status': 'status' },
        conditionValues: { ':readyStatus': 'READY' },
      }),
    );
    expect(result).toEqual(updated);
  });

  it('no-ops (returns null) when the plan is not READY', async () => {
    const conditionError = new Error('The conditional request failed');
    conditionError.name = 'ConditionalCheckFailedException';
    mockUpdateItem.mockRejectedValue(conditionError);

    await expect(markSolutionPlanStale(args)).resolves.toBeNull();
  });

  it('no-ops (returns null) when the plan does not exist', async () => {
    // Missing item also fails the condition expression — same guard path.
    const conditionError = new Error('The conditional request failed');
    conditionError.name = 'ConditionalCheckFailedException';
    mockUpdateItem.mockRejectedValue(conditionError);

    await expect(markSolutionPlanStale(args)).resolves.toBeNull();
  });

  it('rethrows non-conditional errors', async () => {
    mockUpdateItem.mockRejectedValue(new Error('boom'));
    await expect(markSolutionPlanStale(args)).rejects.toThrow('boom');
  });
});

// ─── Grilling transcript ────────────────────────────────────────────────────────

describe('appendGrillingMessage', () => {
  it('writes the message under GRILLING_MESSAGE_PK with a round-padded SK', async () => {
    const result = await appendGrillingMessage({
      solutionPlanId: 'plan-1',
      runId: 'run-1',
      round: 2,
      role: 'GRILLER',
      content: 'What is the migration strategy?',
    });

    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const [pk, sk, item] = mockPutItem.mock.calls[0];
    expect(pk).toBe(GRILLING_MESSAGE_PK);
    expect(sk).toMatch(/^plan-1#002#\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f-]{36}$/);
    expect(item).toMatchObject({
      solutionPlanId: 'plan-1',
      runId: 'run-1',
      round: 2,
      role: 'GRILLER',
      content: 'What is the migration strategy?',
    });
    // SK segments are reconstructable from the stored item
    expect(sk).toBe(`plan-1#002#${item.createdAt}#${item.id}`);
    expect(result).toEqual(item);
  });

  it('passes tool call summaries through', async () => {
    await appendGrillingMessage({
      solutionPlanId: 'plan-1',
      runId: 'run-1',
      round: 1,
      role: 'TECH_LEAD',
      content: 'We would use the existing pipeline.',
      toolCalls: [{ toolName: 'search_knowledge_base', summary: '3 hits' }],
    });
    const item = mockPutItem.mock.calls[0][2];
    expect(item.toolCalls).toEqual([{ toolName: 'search_knowledge_base', summary: '3 hits' }]);
  });
});

describe('listGrillingMessages', () => {
  it('queries all messages by plan-id SK prefix', async () => {
    const messages = [{ id: 'm1' }, { id: 'm2' }];
    mockQueryAllBySkPrefix.mockResolvedValue(messages);

    const result = await listGrillingMessages('plan-1');

    expect(mockQueryAllBySkPrefix).toHaveBeenCalledWith(GRILLING_MESSAGE_PK, 'plan-1#');
    expect(result).toEqual(messages);
  });
});

describe('deleteGrillingMessages', () => {
  it('deletes all messages by plan-id SK prefix', async () => {
    mockDeleteAllBySkPrefix.mockResolvedValue({ deleted: 5, failed: 0 });

    const result = await deleteGrillingMessages('plan-1');

    expect(mockDeleteAllBySkPrefix).toHaveBeenCalledWith(GRILLING_MESSAGE_PK, 'plan-1#');
    expect(result).toEqual({ deleted: 5, failed: 0 });
  });
});

// ─── S3 HTML content ────────────────────────────────────────────────────────────

describe('solution plan HTML in S3', () => {
  const keyArgs = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', version: 2 };

  it('builds the versioned S3 key', () => {
    expect(buildSolutionPlanHtmlKey(keyArgs)).toBe(
      'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
    );
  });

  it('uploads a UTF-8 buffer with the html content type and returns the key', async () => {
    const key = await uploadSolutionPlanHtml({ ...keyArgs, html: '<h1>Plan</h1>' });

    expect(key).toBe('org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html');
    expect(mockUploadToS3).toHaveBeenCalledWith(
      'test-bucket',
      key,
      Buffer.from('<h1>Plan</h1>', 'utf-8'),
      'text/html; charset=utf-8',
    );
  });

  it('rejects empty or whitespace-only HTML', async () => {
    await expect(uploadSolutionPlanHtml({ ...keyArgs, html: '' })).rejects.toThrow(
      /empty solution plan HTML/,
    );
    await expect(uploadSolutionPlanHtml({ ...keyArgs, html: '   \n' })).rejects.toThrow(
      /empty solution plan HTML/,
    );
    expect(mockUploadToS3).not.toHaveBeenCalled();
  });

  it('loads HTML from the documents bucket by contentKey', async () => {
    mockLoadTextFromS3.mockResolvedValue('<h1>Plan</h1>');

    const html = await loadSolutionPlanHtml('org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html');

    expect(mockLoadTextFromS3).toHaveBeenCalledWith(
      'test-bucket',
      'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
    );
    expect(html).toBe('<h1>Plan</h1>');
  });
});
