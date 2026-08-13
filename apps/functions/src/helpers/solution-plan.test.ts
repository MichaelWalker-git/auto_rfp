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
const mockBatchDeleteItems = jest.fn();

jest.mock('@/helpers/db', () => ({
  createItem: (...a: unknown[]) => mockCreateItem(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  putItem: (...a: unknown[]) => mockPutItem(...a),
  updateItem: (...a: unknown[]) => mockUpdateItem(...a),
  queryAllBySkPrefix: (...a: unknown[]) => mockQueryAllBySkPrefix(...a),
  batchDeleteItems: (...a: unknown[]) => mockBatchDeleteItems(...a),
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
  markSolutionPlanStaleSafe,
  padGrillingRound,
  putSolutionPlan,
  toGrillingMessageItem,
  toSolutionPlanItem,
  updateSolutionPlanContent,
  updateSolutionPlanStatus,
  uploadSolutionPlanHtml,
} from './solution-plan';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { GRILLING_MESSAGE_PK, SOLUTION_PLAN_PK } from '@/constants/solution-plan';
import type { SolutionPlanItem, SolutionPlanKey } from '@auto-rfp/core';

const planKey: SolutionPlanKey = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
};

const basePlan: SolutionPlanItem = {
  id: 'plan-1',
  ...planKey,
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
    expect(buildSolutionPlanSk(planKey)).toBe('org-1#proj-1#opp-1');
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
    const plan = await getSolutionPlanByOpportunity(planKey);
    expect(mockGetItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, 'org-1#proj-1#opp-1');
    expect(plan).toEqual(basePlan);
  });

  it('returns null when no plan exists', async () => {
    mockGetItem.mockResolvedValue(null);
    await expect(getSolutionPlanByOpportunity(planKey)).resolves.toBeNull();
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
    await updateSolutionPlanStatus(planKey, 'READY', {
      contentKey: 'some/key.html',
      version: 3,
    });
    expect(mockUpdateItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, 'org-1#proj-1#opp-1', {
      status: 'READY',
      contentKey: 'some/key.html',
      version: 3,
    });
  });

  it('works without a patch', async () => {
    await updateSolutionPlanStatus(planKey, 'GENERATING_SOT');
    expect(mockUpdateItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, 'org-1#proj-1#opp-1', {
      status: 'GENERATING_SOT',
    });
  });
});

// ─── DB-key stripping ───────────────────────────────────────────────────────────

describe('toSolutionPlanItem / toGrillingMessageItem', () => {
  it('strips partition_key/sort_key off a plan record', () => {
    const item = toSolutionPlanItem({
      ...basePlan,
      [PK_NAME]: SOLUTION_PLAN_PK,
      [SK_NAME]: 'org-1#proj-1#opp-1',
    });
    expect(item).toEqual(basePlan);
    expect(item).not.toHaveProperty(PK_NAME);
    expect(item).not.toHaveProperty(SK_NAME);
  });

  it('strips partition_key/sort_key off a transcript record', () => {
    const base = {
      id: 'msg-1',
      solutionPlanId: 'plan-1',
      runId: 'run-1',
      round: 1,
      role: 'GRILLER' as const,
      content: 'Q?',
    };
    const item = toGrillingMessageItem({
      ...base,
      [PK_NAME]: GRILLING_MESSAGE_PK,
      [SK_NAME]: 'plan-1#001#ts#msg-1',
    });
    expect(item).toEqual(base);
  });
});

// ─── updateSolutionPlanContent (ADR-8 guard) ────────────────────────────────────

describe('updateSolutionPlanContent', () => {
  const patch = { version: 3, contentKey: 'org-1/proj-1/opp-1/solution-plan/v3/solution-plan.html', editedBy: 'user-9' };

  it('bumps content fields, marks user-edited, clears staleness — READY-only condition', async () => {
    const updated = { ...basePlan, status: 'READY', ...patch, isUserEdited: true, isStale: false };
    mockUpdateItem.mockResolvedValue(updated);

    const result = await updateSolutionPlanContent(planKey, patch);

    expect(mockUpdateItem).toHaveBeenCalledWith(
      SOLUTION_PLAN_PK,
      'org-1#proj-1#opp-1',
      { ...patch, isUserEdited: true, isStale: false, staleReason: '' },
      expect.objectContaining({
        condition: expect.stringContaining('#status = :readyStatus'),
        conditionNames: { '#pk': PK_NAME, '#status': 'status', '#version': 'version' },
        conditionValues: { ':readyStatus': 'READY', ':expectedVersion': 2 },
      }),
    );
    expect(result).toEqual(updated);
  });

  it('conditions on the pre-bump version so concurrent edits cannot collide (ADR-11)', async () => {
    mockUpdateItem.mockResolvedValue({});
    await updateSolutionPlanContent(planKey, patch);
    const options = mockUpdateItem.mock.calls[0][3];
    expect(options.condition).toContain('#version = :expectedVersion');
    expect(options.conditionValues[':expectedVersion']).toBe(patch.version - 1);
  });

  it.each([
    'the plan is not READY',
    'the plan does not exist',
    'another edit already claimed this version',
  ])('returns null when %s and the condition fails', async () => {
    const conditionError = new Error('The conditional request failed');
    conditionError.name = 'ConditionalCheckFailedException';
    mockUpdateItem.mockRejectedValue(conditionError);

    await expect(updateSolutionPlanContent(planKey, patch)).resolves.toBeNull();
  });

  it('rethrows non-conditional errors', async () => {
    mockUpdateItem.mockRejectedValue(new Error('boom'));
    await expect(updateSolutionPlanContent(planKey, patch)).rejects.toThrow('boom');
  });
});

// ─── markSolutionPlanStale (ADR-3 guard) ────────────────────────────────────────

describe('markSolutionPlanStale', () => {
  const reason = 'Exec brief regenerated';

  it('sets isStale + staleReason with a READY-only condition', async () => {
    const updated = { ...basePlan, status: 'READY', isStale: true, staleReason: reason };
    mockUpdateItem.mockResolvedValue(updated);

    const result = await markSolutionPlanStale(planKey, reason);

    expect(mockUpdateItem).toHaveBeenCalledWith(
      SOLUTION_PLAN_PK,
      'org-1#proj-1#opp-1',
      { isStale: true, staleReason: reason },
      expect.objectContaining({
        condition: expect.stringContaining('#status = :readyStatus'),
        conditionNames: { '#pk': PK_NAME, '#status': 'status' },
        conditionValues: { ':readyStatus': 'READY' },
      }),
    );
    expect(result).toEqual(updated);
  });

  // Both guard branches (plan not READY / plan missing) surface as the same
  // failed condition expression — DynamoDB doesn't say which clause failed.
  it.each(['the plan is not READY', 'the plan does not exist'])(
    'no-ops (returns null) when %s and the condition fails',
    async () => {
      const conditionError = new Error('The conditional request failed');
      conditionError.name = 'ConditionalCheckFailedException';
      mockUpdateItem.mockRejectedValue(conditionError);

      await expect(markSolutionPlanStale(planKey, reason)).resolves.toBeNull();
    },
  );

  it('rethrows non-conditional errors', async () => {
    mockUpdateItem.mockRejectedValue(new Error('boom'));
    await expect(markSolutionPlanStale(planKey, reason)).rejects.toThrow('boom');
  });
});

// ─── markSolutionPlanStaleSafe (T13 trigger wrapper) ────────────────────────────

describe('markSolutionPlanStaleSafe', () => {
  const reason = 'New solicitation document uploaded';

  it('passes the updated plan through on success', async () => {
    const updated = { ...basePlan, status: 'READY', isStale: true, staleReason: reason };
    mockUpdateItem.mockResolvedValue(updated);

    await expect(markSolutionPlanStaleSafe(planKey, reason)).resolves.toEqual(updated);
    expect(mockUpdateItem).toHaveBeenCalledWith(
      SOLUTION_PLAN_PK,
      'org-1#proj-1#opp-1',
      { isStale: true, staleReason: reason },
      expect.anything(),
    );
  });

  it('returns null (guard no-op) when the plan is missing or not READY', async () => {
    const conditionError = new Error('The conditional request failed');
    conditionError.name = 'ConditionalCheckFailedException';
    mockUpdateItem.mockRejectedValue(conditionError);

    await expect(markSolutionPlanStaleSafe(planKey, reason)).resolves.toBeNull();
  });

  it('swallows unexpected errors instead of failing the host request', async () => {
    mockUpdateItem.mockRejectedValue(new Error('DynamoDB unavailable'));
    await expect(markSolutionPlanStaleSafe(planKey, reason)).resolves.toBeNull();
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
  it('batch-deletes every listed message under the GRILLING_MESSAGE PK', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      { id: 'm1', [SK_NAME]: 'plan-1#001#ts1#m1' },
      { id: 'm2', [SK_NAME]: 'plan-1#001#ts2#m2' },
    ]);
    mockBatchDeleteItems.mockResolvedValue({ deleted: 2, failed: 0 });

    const deleted = await deleteGrillingMessages('plan-1');

    expect(mockBatchDeleteItems).toHaveBeenCalledWith([
      { pk: GRILLING_MESSAGE_PK, sk: 'plan-1#001#ts1#m1' },
      { pk: GRILLING_MESSAGE_PK, sk: 'plan-1#001#ts2#m2' },
    ]);
    expect(deleted).toBe(2);
  });

  it('is a no-op when the transcript is already empty', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([]);

    await expect(deleteGrillingMessages('plan-1')).resolves.toBe(0);
    expect(mockBatchDeleteItems).not.toHaveBeenCalled();
  });

  it('does not throw when some deletes fail (leftovers are runId-filtered)', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([{ id: 'm1', [SK_NAME]: 'plan-1#001#ts1#m1' }]);
    mockBatchDeleteItems.mockResolvedValue({ deleted: 0, failed: 1 });

    await expect(deleteGrillingMessages('plan-1')).resolves.toBe(0);
  });
});

// ─── S3 HTML content ────────────────────────────────────────────────────────────

describe('solution plan HTML in S3', () => {
  it('builds the versioned S3 key', () => {
    expect(buildSolutionPlanHtmlKey(planKey, 2)).toBe(
      'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
    );
  });

  it('uploads a UTF-8 buffer with the html content type and returns the key', async () => {
    const key = await uploadSolutionPlanHtml(planKey, 2, '<h1>Plan</h1>');

    expect(key).toBe('org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html');
    expect(mockUploadToS3).toHaveBeenCalledWith(
      'test-bucket',
      key,
      Buffer.from('<h1>Plan</h1>', 'utf-8'),
      'text/html; charset=utf-8',
    );
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
