import { describe, expect, it } from 'vitest';

import {
  PlanTeamMemberSchema,
  PlanTeamRegenerateResponseSchema,
  PlanTeamSaveRequestSchema,
  PlanTeamSchema,
} from './solution-plan';

describe('PlanTeamMemberSchema — the three line shapes (BR1.3/BR3.3)', () => {
  it('accepts a FILLED line (employeeId + nameSnapshot + rationale)', () => {
    const { success, data } = PlanTeamMemberSchema.safeParse({
      employeeId: 'emp-1',
      nameSnapshot: 'Jane Doe',
      role: 'Senior Engineer',
      staffingPositionRef: 'Senior Engineer',
      rationale: 'PMP certified with 8 years of federal delivery experience.',
    });
    expect(success).toBe(true);
    // Defaults applied
    expect(data?.removedEmployee).toBe(false);
    expect(data?.source).toBe('AI_RECOMMENDED');
  });

  it('accepts a DELETED-employee line (nameSnapshot + removedEmployee, no employeeId)', () => {
    const { success, data } = PlanTeamMemberSchema.safeParse({
      nameSnapshot: 'John Smith',
      role: 'Project Manager',
      removedEmployee: true,
      rationale: 'Strongest PM certification match.',
    });
    expect(success).toBe(true);
    expect(data?.employeeId).toBeUndefined();
    expect(data?.removedEmployee).toBe(true);
  });

  it('accepts an UNFILLED line (role only)', () => {
    const { success, data } = PlanTeamMemberSchema.safeParse({
      role: 'Cloud Architect',
      staffingPositionRef: 'Cloud Architect',
    });
    expect(success).toBe(true);
    expect(data?.employeeId).toBeUndefined();
    expect(data?.nameSnapshot).toBeUndefined();
    expect(data?.rationale).toBeUndefined();
  });

  it('rejects a filled line without nameSnapshot', () => {
    const { success, error } = PlanTeamMemberSchema.safeParse({
      employeeId: 'emp-1',
      role: 'Senior Engineer',
    });
    expect(success).toBe(false);
    expect(error?.issues.some((i) => i.path.includes('nameSnapshot'))).toBe(true);
  });

  it('rejects a removed-employee line that still carries an employeeId', () => {
    const { success, error } = PlanTeamMemberSchema.safeParse({
      employeeId: 'emp-1',
      nameSnapshot: 'Jane Doe',
      role: 'Senior Engineer',
      removedEmployee: true,
    });
    expect(success).toBe(false);
    expect(error?.issues.some((i) => i.path.includes('employeeId'))).toBe(true);
  });

  it('rejects a removed-employee line without nameSnapshot', () => {
    const { success, error } = PlanTeamMemberSchema.safeParse({
      role: 'Senior Engineer',
      removedEmployee: true,
    });
    expect(success).toBe(false);
    expect(error?.issues.some((i) => i.path.includes('nameSnapshot'))).toBe(true);
  });

  it('rejects an empty role', () => {
    const { success } = PlanTeamMemberSchema.safeParse({ role: '   ' });
    expect(success).toBe(false);
  });
});

describe('PlanTeamSchema', () => {
  it('applies defaults — empty members, userModified false', () => {
    const { success, data } = PlanTeamSchema.safeParse({});
    expect(success).toBe(true);
    expect(data?.members).toEqual([]);
    expect(data?.userModified).toBe(false);
    expect(data?.generatedAt).toBeUndefined();
    expect(data?.savedAt).toBeUndefined();
  });

  it('accepts a full team with timestamps', () => {
    const { success } = PlanTeamSchema.safeParse({
      members: [
        { employeeId: 'emp-1', nameSnapshot: 'Jane Doe', role: 'Engineer', rationale: 'Best fit.' },
        { role: 'Open Slot' },
      ],
      userModified: true,
      generatedAt: '2026-08-19T10:00:00.000Z',
      savedAt: '2026-08-19T11:00:00.000Z',
    });
    expect(success).toBe(true);
  });
});

describe('PlanTeamSaveRequestSchema', () => {
  it('accepts a valid members array', () => {
    const { success } = PlanTeamSaveRequestSchema.safeParse({
      members: [{ employeeId: 'emp-1', nameSnapshot: 'Jane Doe', role: 'Engineer', source: 'MANUAL' }],
    });
    expect(success).toBe(true);
  });

  it('rejects a missing members array and invalid member shapes', () => {
    expect(PlanTeamSaveRequestSchema.safeParse({}).success).toBe(false);
    expect(
      PlanTeamSaveRequestSchema.safeParse({ members: [{ employeeId: 'emp-1', role: 'Engineer' }] })
        .success,
    ).toBe(false);
  });
});

describe('PlanTeamRegenerateResponseSchema', () => {
  it('accepts the empty-pool prerequisite response (BR4.1)', () => {
    const { success, data } = PlanTeamRegenerateResponseSchema.safeParse({
      ok: true,
      team: null,
      emptyPool: true,
    });
    expect(success).toBe(true);
    expect(data?.emptyPool).toBe(true);
  });
});
