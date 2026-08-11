import { describe, it, expect } from 'vitest';
import { PK_NAME, SK_NAME } from '../constants';
import {
  SolutionPlanStatusSchema,
  SolutionPlanKeySchema,
  SolutionPlanCreateRequestSchema,
  SolutionPlanStatusPatchSchema,
  SolutionPlanUpdateRequestSchema,
  SolutionPlanItemSchema,
  SolutionPlanDBItemSchema,
  SolutionPlanListItemSchema,
  GrillingMessageRoleSchema,
  GrillingMessageItemSchema,
  GrillingMessageDBItemSchema,
  GrillingMessageListItemSchema,
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
