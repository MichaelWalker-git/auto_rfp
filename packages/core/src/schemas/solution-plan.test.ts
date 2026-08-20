import { describe, it, expect } from 'vitest';
import { PK_NAME, SK_NAME } from '../constants';
import {
  SolutionPlanStatusSchema,
  SolutionPlanErrorCodeSchema,
  SolutionPlanKeySchema,
  SolutionPlanCreateRequestSchema,
  SolutionPlanInitRequestSchema,
  SolutionPlanStatusPatchSchema,
  SolutionPlanUpdateRequestSchema,
  SolutionPlanItemSchema,
  SolutionPlanCostItemSchema,
  SolutionPlanCostScheduleSchema,
  SolutionPlanDBItemSchema,
  SolutionPlanListItemSchema,
  GrillingMessageRoleSchema,
  GrillingMessageItemSchema,
  GrillingMessageDBItemSchema,
  GrillingMessageListItemSchema,
  SolutionPlanInitResponseSchema,
  SolutionPlanResponseSchema,
  SolutionPlanTranscriptResponseSchema,
  SolutionPlanHtmlContentResponseSchema,
  SOLUTION_PLAN_GATE_EXEMPT_DOCUMENT_TYPES,
  isSolutionPlanGatedDocumentType,
  type SolutionPlanItem,
  type SolutionPlanListItem,
} from './solution-plan';

const validItem = {
  id: 'plan-123',
  orgId: 'org-123',
  projectId: 'proj-456',
  opportunityId: 'opp-789',
  status: 'READY',
  runId: 'run-abc',
  version: 1,
};

describe('SolutionPlanStatusSchema', () => {
  it.each(['GRILLING', 'GENERATING_SOT', 'READY', 'FAILED'])(
    'should accept %s',
    (status) => {
      expect(SolutionPlanStatusSchema.parse(status)).toBe(status);
    }
  );

  it('should reject unknown statuses', () => {
    expect(() => SolutionPlanStatusSchema.parse('STALE')).toThrow();
    expect(() => SolutionPlanStatusSchema.parse('DONE')).toThrow();
  });
});

describe('SolutionPlanErrorCodeSchema', () => {
  it.each([
    'SOLUTION_PLAN_NOT_READY',
    'SOLUTION_PLAN_CONFLICT',
    'SOLUTION_PLAN_RUN_IN_PROGRESS',
    'SOLUTION_PLAN_REQUIRED',
  ])('should accept %s', (code) => {
    expect(SolutionPlanErrorCodeSchema.parse(code)).toBe(code);
  });

  it('should reject unknown codes', () => {
    expect(() => SolutionPlanErrorCodeSchema.parse('SOLUTION_PLAN_STALE')).toThrow();
    expect(() => SolutionPlanErrorCodeSchema.parse('')).toThrow();
  });
});

describe('isSolutionPlanGatedDocumentType', () => {
  it.each([...SOLUTION_PLAN_GATE_EXEMPT_DOCUMENT_TYPES])('should exempt %s', (documentType) => {
    expect(isSolutionPlanGatedDocumentType(documentType)).toBe(false);
  });

  it('should gate built-in proposal types', () => {
    expect(isSolutionPlanGatedDocumentType('COST_PROPOSAL')).toBe(true);
    expect(isSolutionPlanGatedDocumentType('TECHNICAL_PROPOSAL')).toBe(true);
  });

  it('should gate custom document types', () => {
    expect(isSolutionPlanGatedDocumentType('MY_CUSTOM_TYPE')).toBe(true);
  });
});

describe('SolutionPlanKeySchema', () => {
  it('should accept the identifier triple', () => {
    const { success, data } = SolutionPlanKeySchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
    });
    expect(success).toBe(true);
    expect(data).toEqual({
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
    });
  });

  it.each(['orgId', 'projectId', 'opportunityId'])('should require %s', (field) => {
    const key: Record<string, string> = {
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
    };
    delete key[field];
    expect(SolutionPlanKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('SolutionPlanCreateRequestSchema', () => {
  it('should accept valid create data', () => {
    const { success, data } = SolutionPlanCreateRequestSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
    });
    expect(success).toBe(true);
    expect(data?.opportunityId).toBe('opp-789');
  });

  it.each(['orgId', 'projectId', 'opportunityId'])(
    'should require %s',
    (field) => {
      const body: Record<string, string> = {
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
      };
      delete body[field];
      expect(SolutionPlanCreateRequestSchema.safeParse(body).success).toBe(false);
    }
  );

  it('should reject empty identifiers', () => {
    expect(
      SolutionPlanCreateRequestSchema.safeParse({
        orgId: '',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
      }).success
    ).toBe(false);
  });
});

describe('SolutionPlanInitRequestSchema', () => {
  it('should accept the key triple without a restart flag', () => {
    const { success, data } = SolutionPlanInitRequestSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
    });
    expect(success).toBe(true);
    expect(data?.restart).toBeUndefined();
  });

  it('should accept an explicit restart intent', () => {
    const { success, data } = SolutionPlanInitRequestSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
      restart: true,
    });
    expect(success).toBe(true);
    expect(data?.restart).toBe(true);
  });

  it('should reject a non-boolean restart flag', () => {
    expect(
      SolutionPlanInitRequestSchema.safeParse({
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        restart: 'yes',
      }).success
    ).toBe(false);
  });
});

describe('SolutionPlanUpdateRequestSchema', () => {
  it('should accept an html content patch', () => {
    const { success, data } = SolutionPlanUpdateRequestSchema.safeParse({
      htmlContent: '<h1>Updated plan</h1>',
    });
    expect(success).toBe(true);
    expect(data?.htmlContent).toBe('<h1>Updated plan</h1>');
  });

  it('should reject empty html content', () => {
    expect(
      SolutionPlanUpdateRequestSchema.safeParse({ htmlContent: '' }).success
    ).toBe(false);
  });

  it('should require htmlContent', () => {
    expect(SolutionPlanUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('should not allow patching identifiers', () => {
    const { success, data } = SolutionPlanUpdateRequestSchema.safeParse({
      htmlContent: '<p>ok</p>',
      orgId: 'other-org',
    });
    expect(success).toBe(true);
    expect(data).not.toHaveProperty('orgId');
  });
});

describe('SolutionPlanStatusPatchSchema', () => {
  it('should accept an empty patch (all fields optional)', () => {
    expect(SolutionPlanStatusPatchSchema.safeParse({}).success).toBe(true);
  });

  it('should accept transition-related fields', () => {
    const { success, data } = SolutionPlanStatusPatchSchema.safeParse({
      contentKey: 'org/proj/opp/solution-plan/v2/solution-plan.html',
      version: 2,
      grillingCompletedAt: '2026-08-11T00:00:00.000Z',
      error: 'synthesis timed out',
    });
    expect(success).toBe(true);
    expect(data?.version).toBe(2);
  });

  it('should not allow patching status or identifiers', () => {
    const { success, data } = SolutionPlanStatusPatchSchema.safeParse({
      status: 'READY',
      orgId: 'other-org',
      version: 1,
    });
    expect(success).toBe(true);
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('orgId');
  });

  it('should validate patched field types', () => {
    expect(SolutionPlanStatusPatchSchema.safeParse({ version: -1 }).success).toBe(false);
    expect(SolutionPlanStatusPatchSchema.safeParse({ isStale: 'yes' }).success).toBe(false);
  });

  it('should accept a costSchedule (persisted with the READY patch) and null (cleared)', () => {
    const { success, data } = SolutionPlanStatusPatchSchema.safeParse({
      costSchedule: {
        items: [{ label: 'Hosting', amount: 400, billing: 'MONTHLY' }],
        oneTimeTotal: 0,
        ongoingAnnualTotal: 4800,
      },
    });
    expect(success).toBe(true);
    expect(data?.costSchedule?.items).toHaveLength(1);
    expect(SolutionPlanStatusPatchSchema.safeParse({ costSchedule: null }).success).toBe(true);
  });
});

describe('SolutionPlanCostItemSchema', () => {
  const validCostItem = {
    label: 'Managed hosting',
    category: 'LABOR',
    amount: 400,
    billing: 'MONTHLY',
  };

  it('should accept a valid priced item', () => {
    const { success, data } = SolutionPlanCostItemSchema.safeParse(validCostItem);
    expect(success).toBe(true);
    expect(data?.amount).toBe(400);
  });

  it('should accept a null amount (vendor quote required)', () => {
    const { success, data } = SolutionPlanCostItemSchema.safeParse({
      ...validCostItem,
      amount: null,
    });
    expect(success).toBe(true);
    expect(data?.amount).toBeNull();
  });

  it('should reject a negative amount', () => {
    expect(
      SolutionPlanCostItemSchema.safeParse({ ...validCostItem, amount: -1 }).success
    ).toBe(false);
  });

  it('should default the category to OTHER and catch unknown categories', () => {
    const { category: _omitted, ...noCategory } = validCostItem;
    expect(SolutionPlanCostItemSchema.parse(noCategory).category).toBe('OTHER');
    expect(
      SolutionPlanCostItemSchema.parse({ ...validCostItem, category: 'CLOUD_STUFF' }).category
    ).toBe('OTHER');
  });

  it('should reject an unknown billing period', () => {
    expect(
      SolutionPlanCostItemSchema.safeParse({ ...validCostItem, billing: 'QUARTERLY' }).success
    ).toBe(false);
  });

  it('should require a non-empty label', () => {
    expect(
      SolutionPlanCostItemSchema.safeParse({ ...validCostItem, label: '' }).success
    ).toBe(false);
  });

  it('should default optional to false when omitted (legacy items)', () => {
    expect(SolutionPlanCostItemSchema.parse(validCostItem).optional).toBe(false);
  });

  it('should accept an explicit optional flag', () => {
    expect(
      SolutionPlanCostItemSchema.parse({ ...validCostItem, optional: true }).optional
    ).toBe(true);
    expect(
      SolutionPlanCostItemSchema.parse({ ...validCostItem, optional: false }).optional
    ).toBe(false);
  });

  it('should catch a malformed optional value to false', () => {
    expect(
      SolutionPlanCostItemSchema.parse({ ...validCostItem, optional: 'yes' }).optional
    ).toBe(false);
  });
});

describe('SolutionPlanCostScheduleSchema', () => {
  const validSchedule = {
    items: [{ label: 'Setup', amount: 1000, billing: 'ONE_TIME' }],
    oneTimeTotal: 1000,
    ongoingAnnualTotal: 0,
  };

  it('should accept a valid schedule and default the currency to USD', () => {
    const { success, data } = SolutionPlanCostScheduleSchema.safeParse(validSchedule);
    expect(success).toBe(true);
    expect(data?.currency).toBe('USD');
  });

  it('should require at least one item', () => {
    expect(
      SolutionPlanCostScheduleSchema.safeParse({ ...validSchedule, items: [] }).success
    ).toBe(false);
  });

  it('should reject negative totals', () => {
    expect(
      SolutionPlanCostScheduleSchema.safeParse({ ...validSchedule, oneTimeTotal: -1 }).success
    ).toBe(false);
    expect(
      SolutionPlanCostScheduleSchema.safeParse({ ...validSchedule, ongoingAnnualTotal: -1 }).success
    ).toBe(false);
  });

  it('should accept optional assumptions', () => {
    const { success, data } = SolutionPlanCostScheduleSchema.safeParse({
      ...validSchedule,
      assumptions: ['12-month period of performance'],
    });
    expect(success).toBe(true);
    expect(data?.assumptions).toEqual(['12-month period of performance']);
  });

  it('should parse a legacy persisted schedule (items without the optional flag)', () => {
    const { success, data } = SolutionPlanCostScheduleSchema.safeParse({
      items: [
        { label: 'Setup', amount: 1000, billing: 'ONE_TIME' },
        { label: 'Hosting', category: 'LABOR', amount: 400, billing: 'MONTHLY' },
      ],
      oneTimeTotal: 1000,
      ongoingAnnualTotal: 4800,
    });
    expect(success).toBe(true);
    expect(data?.items.map((i) => i.optional)).toEqual([false, false]);
  });
});

describe('SolutionPlanItemSchema', () => {
  it('should accept a minimal valid item and apply defaults', () => {
    const { success, data } = SolutionPlanItemSchema.safeParse(validItem);
    expect(success).toBe(true);
    expect(data?.isStale).toBe(false);
    expect(data?.isUserEdited).toBe(false);
  });

  it('should accept a fully populated item', () => {
    const { success, data } = SolutionPlanItemSchema.safeParse({
      ...validItem,
      status: 'READY',
      isStale: true,
      staleReason: 'Executive brief was regenerated',
      contentKey: 'org-123/proj-456/opp-789/solution-plan/v2/solution-plan.html',
      version: 2,
      isUserEdited: true,
      editedBy: 'user-1',
      grillingRounds: 4,
      grillingCompletedAt: '2026-08-11T10:00:00Z',
      error: undefined,
      createdAt: '2026-08-11T09:00:00Z',
      updatedAt: '2026-08-11T10:00:00Z',
      createdBy: 'user-1',
      updatedBy: 'user-1',
    });
    expect(success).toBe(true);
    expect(data?.staleReason).toBe('Executive brief was regenerated');
    expect(data?.grillingRounds).toBe(4);
  });

  it('should reject an invalid status', () => {
    expect(
      SolutionPlanItemSchema.safeParse({ ...validItem, status: 'PENDING' }).success
    ).toBe(false);
  });

  it('should reject a negative version', () => {
    expect(
      SolutionPlanItemSchema.safeParse({ ...validItem, version: -1 }).success
    ).toBe(false);
  });

  it('should reject a non-integer version', () => {
    expect(
      SolutionPlanItemSchema.safeParse({ ...validItem, version: 1.5 }).success
    ).toBe(false);
  });

  it('should require runId', () => {
    const { runId: _runId, ...rest } = validItem;
    expect(SolutionPlanItemSchema.safeParse(rest).success).toBe(false);
  });

  it('should NOT contain DynamoDB key fields', () => {
    expect(SolutionPlanItemSchema.shape).not.toHaveProperty(PK_NAME);
    expect(SolutionPlanItemSchema.shape).not.toHaveProperty(SK_NAME);
  });

  it('should accept a FAILED item carrying an error message', () => {
    const { success, data } = SolutionPlanItemSchema.safeParse({
      ...validItem,
      status: 'FAILED',
      error: 'Bedrock invocation timed out',
    });
    expect(success).toBe(true);
    expect(data?.error).toBe('Bedrock invocation timed out');
  });

  it('should parse a legacy item without a costSchedule', () => {
    const { success, data } = SolutionPlanItemSchema.safeParse(validItem);
    expect(success).toBe(true);
    expect(data?.costSchedule).toBeUndefined();
  });

  it('should accept a null costSchedule (cleared by a user edit)', () => {
    const { success, data } = SolutionPlanItemSchema.safeParse({
      ...validItem,
      costSchedule: null,
    });
    expect(success).toBe(true);
    expect(data?.costSchedule).toBeNull();
  });

  it('should accept a populated costSchedule', () => {
    const { success, data } = SolutionPlanItemSchema.safeParse({
      ...validItem,
      costSchedule: {
        items: [{ label: 'Hosting', amount: 400, billing: 'MONTHLY' }],
        oneTimeTotal: 0,
        ongoingAnnualTotal: 4800,
      },
    });
    expect(success).toBe(true);
    expect(data?.costSchedule?.ongoingAnnualTotal).toBe(4800);
  });
});

describe('SolutionPlanDBItemSchema', () => {
  it('should require the single-table key fields', () => {
    expect(SolutionPlanDBItemSchema.safeParse(validItem).success).toBe(false);

    const { success } = SolutionPlanDBItemSchema.safeParse({
      ...validItem,
      [PK_NAME]: 'SOLUTION_PLAN',
      [SK_NAME]: 'org-123#proj-456#opp-789',
    });
    expect(success).toBe(true);
  });
});

describe('SolutionPlanListItemSchema', () => {
  it('should accept the lightweight projection', () => {
    const listItem: SolutionPlanListItem = {
      id: 'plan-123',
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
      status: 'GRILLING',
      isStale: false,
      version: 0,
    };
    expect(SolutionPlanListItemSchema.safeParse(listItem).success).toBe(true);
  });

  it('should be structurally assignable from a full item', () => {
    const full: SolutionPlanItem = SolutionPlanItemSchema.parse(validItem);
    expect(SolutionPlanListItemSchema.safeParse(full).success).toBe(true);
  });
});

describe('GrillingMessageRoleSchema', () => {
  it.each(['GRILLER', 'TECH_LEAD', 'SYSTEM'])('should accept %s', (role) => {
    expect(GrillingMessageRoleSchema.parse(role)).toBe(role);
  });

  it('should reject unknown roles', () => {
    expect(() => GrillingMessageRoleSchema.parse('USER')).toThrow();
  });
});

describe('GrillingMessageItemSchema', () => {
  const validMessage = {
    id: 'msg-1',
    solutionPlanId: 'plan-123',
    runId: 'run-abc',
    round: 1,
    role: 'GRILLER',
    content: 'What is the expected concurrent user load?',
  };

  it('should accept a valid message without tool calls', () => {
    const { success, data } = GrillingMessageItemSchema.safeParse(validMessage);
    expect(success).toBe(true);
    expect(data?.toolCalls).toBeUndefined();
  });

  it('should accept a message with tool call summaries', () => {
    const { success, data } = GrillingMessageItemSchema.safeParse({
      ...validMessage,
      role: 'TECH_LEAD',
      toolCalls: [
        { toolName: 'search_knowledge_base', summary: 'query: load balancing' },
        { toolName: 'get_pricing_data' },
      ],
    });
    expect(success).toBe(true);
    expect(data?.toolCalls).toHaveLength(2);
  });

  it('should reject a round below 1', () => {
    expect(
      GrillingMessageItemSchema.safeParse({ ...validMessage, round: 0 }).success
    ).toBe(false);
  });

  it('should require runId (zombie-round protection depends on it)', () => {
    const { runId: _runId, ...rest } = validMessage;
    expect(GrillingMessageItemSchema.safeParse(rest).success).toBe(false);
  });

  it('should reject empty content', () => {
    expect(
      GrillingMessageItemSchema.safeParse({ ...validMessage, content: '' }).success
    ).toBe(false);
  });
});

describe('GrillingMessageListItemSchema', () => {
  it('should be structurally assignable from a full message item', () => {
    const full = GrillingMessageItemSchema.parse({
      id: 'msg-1',
      solutionPlanId: 'plan-123',
      runId: 'run-abc',
      round: 1,
      role: 'GRILLER',
      content: 'What is the expected concurrent user load?',
      createdAt: '2026-08-11T10:00:00Z',
    });
    const { success, data } = GrillingMessageListItemSchema.safeParse(full);
    expect(success).toBe(true);
    expect(data?.role).toBe('GRILLER');
  });

  it('should reject an unknown role', () => {
    expect(
      GrillingMessageListItemSchema.safeParse({
        id: 'msg-1',
        round: 1,
        role: 'USER',
        content: 'hi',
      }).success
    ).toBe(false);
  });
});

describe('GrillingMessageDBItemSchema', () => {
  it('should require the single-table key fields', () => {
    const { success } = GrillingMessageDBItemSchema.safeParse({
      id: 'msg-1',
      solutionPlanId: 'plan-123',
      runId: 'run-abc',
      round: 2,
      role: 'SYSTEM',
      content: 'Interview complete.',
      [PK_NAME]: 'GRILLING_MESSAGE',
      [SK_NAME]: 'plan-123#002#2026-08-11T10:00:00Z#msg-1',
    });
    expect(success).toBe(true);
  });
});

describe('API response schemas', () => {
  it('SolutionPlanInitResponseSchema should accept the init handler body', () => {
    const { success } = SolutionPlanInitResponseSchema.safeParse({
      ok: true,
      solutionPlanId: 'plan-123',
      runId: 'run-abc',
      status: 'GRILLING',
      version: 0,
      regenerated: false,
      wipedMessages: 0,
    });
    expect(success).toBe(true);
  });

  it('SolutionPlanInitResponseSchema should reject a body missing runId', () => {
    expect(
      SolutionPlanInitResponseSchema.safeParse({
        ok: true,
        solutionPlanId: 'plan-123',
        status: 'GRILLING',
        version: 0,
        regenerated: false,
        wipedMessages: 0,
      }).success
    ).toBe(false);
  });

  it('SolutionPlanInitResponseSchema should reject an unknown status and negative counts', () => {
    const valid = {
      ok: true,
      solutionPlanId: 'plan-123',
      runId: 'run-abc',
      status: 'GRILLING',
      version: 0,
      regenerated: false,
      wipedMessages: 0,
    };
    expect(
      SolutionPlanInitResponseSchema.safeParse({ ...valid, status: 'QUEUED' }).success
    ).toBe(false);
    expect(
      SolutionPlanInitResponseSchema.safeParse({ ...valid, wipedMessages: -1 }).success
    ).toBe(false);
  });

  it('SolutionPlanResponseSchema should wrap a full plan item', () => {
    const { success } = SolutionPlanResponseSchema.safeParse({
      ok: true,
      plan: validItem,
    });
    expect(success).toBe(true);
  });

  it('SolutionPlanResponseSchema should reject a missing or invalid plan', () => {
    expect(SolutionPlanResponseSchema.safeParse({ ok: true }).success).toBe(false);
    expect(
      SolutionPlanResponseSchema.safeParse({
        ok: true,
        plan: { ...validItem, status: 'PENDING' },
      }).success
    ).toBe(false);
  });

  it('SolutionPlanTranscriptResponseSchema should accept a message list', () => {
    const { success, data } = SolutionPlanTranscriptResponseSchema.safeParse({
      ok: true,
      solutionPlanId: 'plan-123',
      runId: 'run-abc',
      status: 'GRILLING',
      messages: [
        {
          id: 'msg-1',
          solutionPlanId: 'plan-123',
          runId: 'run-abc',
          round: 1,
          role: 'GRILLER',
          content: 'What is the expected concurrent user load?',
        },
      ],
    });
    expect(success).toBe(true);
    expect(data?.messages).toHaveLength(1);
  });

  it('SolutionPlanTranscriptResponseSchema should require messages and reject invalid ones', () => {
    const envelope = {
      ok: true,
      solutionPlanId: 'plan-123',
      runId: 'run-abc',
      status: 'GRILLING',
    };
    expect(SolutionPlanTranscriptResponseSchema.safeParse(envelope).success).toBe(false);
    expect(
      SolutionPlanTranscriptResponseSchema.safeParse({
        ...envelope,
        messages: [
          {
            id: 'msg-1',
            solutionPlanId: 'plan-123',
            runId: 'run-abc',
            round: 1,
            role: 'USER',
            content: 'hi',
          },
        ],
      }).success
    ).toBe(false);
  });

  it('SolutionPlanHtmlContentResponseSchema should require the html body', () => {
    const valid = {
      ok: true,
      html: '<h1>Plan</h1>',
      contentKey: 'org/proj/opp/solution-plan/v1/solution-plan.html',
      version: 1,
      isStale: false,
      isUserEdited: false,
    };
    expect(SolutionPlanHtmlContentResponseSchema.safeParse(valid).success).toBe(true);
    const { html: _html, ...withoutHtml } = valid;
    expect(SolutionPlanHtmlContentResponseSchema.safeParse(withoutHtml).success).toBe(false);
  });
});
