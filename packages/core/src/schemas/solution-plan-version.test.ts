import { describe, it, expect } from 'vitest';
import { PK_NAME, SK_NAME } from '../constants';
import {
  SYSTEM_CREATED_BY,
  SYSTEM_CREATED_BY_NAME,
  SolutionPlanVersionOriginSchema,
  SolutionPlanVersionCreateRequestSchema,
  SolutionPlanVersionUpdateRequestSchema,
  SolutionPlanVersionItemSchema,
  SolutionPlanVersionDBItemSchema,
  SolutionPlanVersionListItemSchema,
  SolutionPlanVersionListRequestSchema,
  SolutionPlanVersionContentRequestSchema,
  SolutionPlanVersionLabelRequestSchema,
  SolutionPlanVersionDeleteRequestSchema,
  SolutionPlanVersionRestoreRequestSchema,
  SolutionPlanVersionListResponseSchema,
  SolutionPlanVersionContentResponseSchema,
  SolutionPlanVersionRestoreResponseSchema,
} from './solution-plan-version';

const validCreateRequest = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  solutionPlanId: 'plan-1',
  versionNumber: 3,
  htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v3/solution-plan.html',
  origin: 'generation',
  createdBy: 'user-1',
  createdByName: 'Alice Example',
};

const validItem = {
  ...validCreateRequest,
  versionId: 'ver-1',
  createdAt: '2026-08-28T00:00:00.000Z',
};

describe('system attribution sentinel (BR3.3, pinned)', () => {
  it('exports the exact canonical literals', () => {
    expect(SYSTEM_CREATED_BY).toBe('SYSTEM');
    expect(SYSTEM_CREATED_BY_NAME).toBe('System');
  });
});

describe('SolutionPlanVersionOriginSchema', () => {
  it.each(['generation', 'manual-save', 'restore'])('accepts %s', (origin) => {
    expect(SolutionPlanVersionOriginSchema.parse(origin)).toBe(origin);
  });

  it('rejects unknown origins (closed enum, BR2.3)', () => {
    expect(SolutionPlanVersionOriginSchema.safeParse('manual save').success).toBe(false);
    expect(SolutionPlanVersionOriginSchema.safeParse('GENERATION').success).toBe(false);
    expect(SolutionPlanVersionOriginSchema.safeParse('team-save').success).toBe(false);
  });
});

describe('SolutionPlanVersionCreateRequestSchema', () => {
  it('accepts a valid capture payload without a cost schedule (manual saves clear it)', () => {
    const { success, data } = SolutionPlanVersionCreateRequestSchema.safeParse(validCreateRequest);
    expect(success).toBe(true);
    expect(data?.costScheduleSnapshot).toBeUndefined();
  });

  it('accepts an embedded costScheduleSnapshot', () => {
    const { success, data } = SolutionPlanVersionCreateRequestSchema.safeParse({
      ...validCreateRequest,
      costScheduleSnapshot: {
        currency: 'USD',
        items: [{ label: 'Hosting', amount: 400, billing: 'MONTHLY' }],
        oneTimeTotal: 0,
        ongoingAnnualTotal: 4800,
      },
    });
    expect(success).toBe(true);
    expect(data?.costScheduleSnapshot?.items).toHaveLength(1);
  });

  it('requires versionNumber to be a positive integer (plan counter, BR2.2)', () => {
    expect(
      SolutionPlanVersionCreateRequestSchema.safeParse({ ...validCreateRequest, versionNumber: 0 })
        .success,
    ).toBe(false);
    expect(
      SolutionPlanVersionCreateRequestSchema.safeParse({
        ...validCreateRequest,
        versionNumber: 1.5,
      }).success,
    ).toBe(false);
  });

  it('requires attribution fields', () => {
    const { createdBy: _cb, ...withoutCreatedBy } = validCreateRequest;
    expect(SolutionPlanVersionCreateRequestSchema.safeParse(withoutCreatedBy).success).toBe(false);
  });
});

describe('SolutionPlanVersionUpdateRequestSchema (label-only patch)', () => {
  it('accepts a label up to 100 characters', () => {
    const { success } = SolutionPlanVersionUpdateRequestSchema.safeParse({
      label: 'a'.repeat(100),
    });
    expect(success).toBe(true);
  });

  it('rejects a label over 100 characters', () => {
    const { success } = SolutionPlanVersionUpdateRequestSchema.safeParse({
      label: 'a'.repeat(101),
    });
    expect(success).toBe(false);
  });

  it('accepts null and omitted label (clear semantics)', () => {
    expect(SolutionPlanVersionUpdateRequestSchema.safeParse({ label: null }).success).toBe(true);
    expect(SolutionPlanVersionUpdateRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe('SolutionPlanVersionItemSchema', () => {
  it('accepts a valid item with optional label omitted', () => {
    const { success } = SolutionPlanVersionItemSchema.safeParse(validItem);
    expect(success).toBe(true);
  });

  it('rejects a label over 100 characters', () => {
    const { success } = SolutionPlanVersionItemSchema.safeParse({
      ...validItem,
      label: 'a'.repeat(101),
    });
    expect(success).toBe(false);
  });

  it('accepts the system sentinel as attribution', () => {
    const { success } = SolutionPlanVersionItemSchema.safeParse({
      ...validItem,
      createdBy: SYSTEM_CREATED_BY,
      createdByName: SYSTEM_CREATED_BY_NAME,
    });
    expect(success).toBe(true);
  });
});

describe('SolutionPlanVersionDBItemSchema', () => {
  it('carries the computed single-table key names', () => {
    const { success, data } = SolutionPlanVersionDBItemSchema.safeParse({
      ...validItem,
      [PK_NAME]: 'SOLUTION_PLAN_VERSION',
      [SK_NAME]: 'org-1#proj-1#opp-1#000003',
    });
    expect(success).toBe(true);
    expect(data?.[PK_NAME]).toBe('SOLUTION_PLAN_VERSION');
    expect(data?.[SK_NAME]).toBe('org-1#proj-1#opp-1#000003');
  });

  it('rejects a record missing the sort key', () => {
    const { success } = SolutionPlanVersionDBItemSchema.safeParse({
      ...validItem,
      [PK_NAME]: 'SOLUTION_PLAN_VERSION',
    });
    expect(success).toBe(false);
  });
});

describe('SolutionPlanVersionListItemSchema', () => {
  it('parses the lightweight projection (a full item is structurally assignable)', () => {
    const { success, data } = SolutionPlanVersionListItemSchema.safeParse({
      versionId: 'ver-1',
      versionNumber: 3,
      origin: 'manual-save',
      label: 'Pre-pricing review',
      createdBy: 'user-1',
      createdByName: 'Alice Example',
      createdAt: '2026-08-28T00:00:00.000Z',
    });
    expect(success).toBe(true);
    expect(data?.origin).toBe('manual-save');
  });
});

// ─── u2 endpoint request schemas (contract C1) ──────────────────────────────────

const planKey = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

describe('SolutionPlanVersionListRequestSchema', () => {
  it('accepts the plan key triple', () => {
    expect(SolutionPlanVersionListRequestSchema.safeParse(planKey).success).toBe(true);
  });

  it('rejects a missing or empty identifier (org scope from the request, BR4.1)', () => {
    const { orgId: _o, ...withoutOrg } = planKey;
    expect(SolutionPlanVersionListRequestSchema.safeParse(withoutOrg).success).toBe(false);
    expect(
      SolutionPlanVersionListRequestSchema.safeParse({ ...planKey, opportunityId: '' }).success,
    ).toBe(false);
  });
});

describe('SolutionPlanVersionContentRequestSchema', () => {
  it('requires versionId alongside the key triple', () => {
    expect(
      SolutionPlanVersionContentRequestSchema.safeParse({ ...planKey, versionId: 'ver-1' })
        .success,
    ).toBe(true);
    expect(SolutionPlanVersionContentRequestSchema.safeParse(planKey).success).toBe(false);
    expect(
      SolutionPlanVersionContentRequestSchema.safeParse({ ...planKey, versionId: '' }).success,
    ).toBe(false);
  });
});

describe('SolutionPlanVersionLabelRequestSchema', () => {
  const base = { ...planKey, versionId: 'ver-1' };

  it('accepts a label up to 100 characters', () => {
    expect(
      SolutionPlanVersionLabelRequestSchema.safeParse({ ...base, label: 'a'.repeat(100) }).success,
    ).toBe(true);
  });

  it('rejects a label over 100 characters (BR2.1)', () => {
    expect(
      SolutionPlanVersionLabelRequestSchema.safeParse({ ...base, label: 'a'.repeat(101) }).success,
    ).toBe(false);
  });

  it('accepts omitted, null, and empty/whitespace labels (clear semantics, BR2.2)', () => {
    expect(SolutionPlanVersionLabelRequestSchema.safeParse(base).success).toBe(true);
    expect(SolutionPlanVersionLabelRequestSchema.safeParse({ ...base, label: null }).success).toBe(
      true,
    );
    expect(SolutionPlanVersionLabelRequestSchema.safeParse({ ...base, label: '   ' }).success).toBe(
      true,
    );
  });

  it('requires versionId', () => {
    expect(
      SolutionPlanVersionLabelRequestSchema.safeParse({ ...planKey, label: 'x' }).success,
    ).toBe(false);
  });
});

describe('SolutionPlanVersionDeleteRequestSchema', () => {
  it('requires the key triple plus versionId', () => {
    expect(
      SolutionPlanVersionDeleteRequestSchema.safeParse({ ...planKey, versionId: 'ver-1' }).success,
    ).toBe(true);
    expect(SolutionPlanVersionDeleteRequestSchema.safeParse(planKey).success).toBe(false);
  });
});

// ─── u2 response envelopes (contract C1) ────────────────────────────────────────

describe('SolutionPlanVersionListResponseSchema', () => {
  const listItem = {
    versionId: 'ver-1',
    versionNumber: 3,
    origin: 'generation',
    createdBy: SYSTEM_CREATED_BY,
    createdByName: SYSTEM_CREATED_BY_NAME,
    createdAt: '2026-08-28T00:00:00.000Z',
  };

  it('accepts rows plus the current marker', () => {
    const { success, data } = SolutionPlanVersionListResponseSchema.safeParse({
      ok: true,
      versions: [listItem],
      currentVersionId: 'ver-1',
    });
    expect(success).toBe(true);
    expect(data?.versions).toHaveLength(1);
  });

  it('accepts an empty history with a null current marker', () => {
    const { success } = SolutionPlanVersionListResponseSchema.safeParse({
      ok: true,
      versions: [],
      currentVersionId: null,
    });
    expect(success).toBe(true);
  });
});

describe('SolutionPlanVersionRestoreRequestSchema (contract C2 body)', () => {
  const validBody = {
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    versionId: 'ver-1',
  };

  it('accepts the key triple plus the source versionId', () => {
    const { success, data } = SolutionPlanVersionRestoreRequestSchema.safeParse(validBody);
    expect(success).toBe(true);
    expect(data?.versionId).toBe('ver-1');
  });

  it('rejects a missing versionId', () => {
    const { versionId: _versionId, ...withoutVersionId } = validBody;
    const { success, error } =
      SolutionPlanVersionRestoreRequestSchema.safeParse(withoutVersionId);
    expect(success).toBe(false);
    expect(error?.issues.some((issue) => issue.path.includes('versionId'))).toBe(true);
  });

  it('rejects an empty orgId (org scope is mandatory, NFR3.10)', () => {
    const { success } = SolutionPlanVersionRestoreRequestSchema.safeParse({
      ...validBody,
      orgId: '',
    });
    expect(success).toBe(false);
  });

  it('carries NO attribution field — restoredBy is server-derived (NFR3.12)', () => {
    expect('restoredBy' in SolutionPlanVersionRestoreRequestSchema.shape).toBe(false);
  });
});

describe('SolutionPlanVersionRestoreResponseSchema (contract C2 envelope)', () => {
  const listItem = {
    versionId: 'ver-9',
    versionNumber: 9,
    origin: 'restore',
    createdBy: 'user-1',
    createdByName: 'Alice Example',
    createdAt: '2026-08-28T00:00:00.000Z',
  };

  it('accepts the ok envelope with the new restore version row', () => {
    const { success, data } = SolutionPlanVersionRestoreResponseSchema.safeParse({
      ok: true,
      newVersion: listItem,
    });
    expect(success).toBe(true);
    expect(data?.newVersion?.origin).toBe('restore');
  });

  it('accepts a null newVersion (capture failed fail-open, restore still succeeded)', () => {
    const { success } = SolutionPlanVersionRestoreResponseSchema.safeParse({
      ok: true,
      newVersion: null,
    });
    expect(success).toBe(true);
  });

  it('rejects a missing newVersion field', () => {
    const { success } = SolutionPlanVersionRestoreResponseSchema.safeParse({ ok: true });
    expect(success).toBe(false);
  });
});

describe('SolutionPlanVersionContentResponseSchema', () => {
  it('carries the html body plus version metadata', () => {
    const { success } = SolutionPlanVersionContentResponseSchema.safeParse({
      ok: true,
      html: '<h1>Plan</h1>',
      version: {
        versionId: 'ver-1',
        versionNumber: 3,
        origin: 'restore',
        label: 'Restored baseline',
        createdBy: 'user-1',
        createdByName: 'Alice Example',
        createdAt: '2026-08-28T00:00:00.000Z',
      },
    });
    expect(success).toBe(true);
  });
});
