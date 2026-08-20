import { describe, it, expect } from 'vitest';
import {
  EmployeeCreateRequestSchema,
  EmployeeUpdateRequestSchema,
  EmployeeItemSchema,
} from './employee';

describe('EmployeeCreateRequestSchema', () => {
  const validCreate = {
    orgId: 'org-123',
    name: 'Jane Smith',
    primaryRoles: ['Project Manager'],
    secondaryRoles: ['Scrum Master'],
    certifications: ['PMP'],
    location: 'ONSHORE',
  };

  it('parses a valid create request and applies list defaults', () => {
    const { success, data } = EmployeeCreateRequestSchema.safeParse({
      orgId: 'org-123',
      name: 'Jane Smith',
    });
    expect(success).toBe(true);
    expect(data?.primaryRoles).toEqual([]);
    expect(data?.secondaryRoles).toEqual([]);
    expect(data?.certifications).toEqual([]);
  });

  it('rejects a missing or empty name (BR1.1)', () => {
    const missing = EmployeeCreateRequestSchema.safeParse({ orgId: 'org-123' });
    expect(missing.success).toBe(false);

    const { success, error } = EmployeeCreateRequestSchema.safeParse({
      orgId: 'org-123',
      name: '   ',
    });
    expect(success).toBe(false);
    expect(error?.issues[0]?.path).toEqual(['name']);
  });

  it('rejects an empty role entry (BR1.2)', () => {
    const { success, error } = EmployeeCreateRequestSchema.safeParse({
      ...validCreate,
      primaryRoles: ['Project Manager', '  '],
    });
    expect(success).toBe(false);
    expect(error?.issues[0]?.path).toEqual(['primaryRoles', 1]);
  });

  it('rejects an invalid location (BR1.3)', () => {
    const { success, error } = EmployeeCreateRequestSchema.safeParse({
      ...validCreate,
      location: 'REMOTE',
    });
    expect(success).toBe(false);
    expect(error?.issues[0]?.path).toEqual(['location']);
  });
});

describe('EmployeeUpdateRequestSchema', () => {
  it('accepts a partial patch and strips nothing required', () => {
    const { success, data } = EmployeeUpdateRequestSchema.safeParse({
      name: 'New Name',
    });
    expect(success).toBe(true);
    expect(data?.name).toBe('New Name');
  });

  it('does not accept orgId (identifiers are not patchable, BR3.2)', () => {
    const { success, data } = EmployeeUpdateRequestSchema.safeParse({
      orgId: 'other-org',
      name: 'New Name',
    });
    // orgId is stripped by omit — never part of the parsed patch
    expect(success).toBe(true);
    expect(data && 'orgId' in data).toBe(false);
  });
});

describe('EmployeeItemSchema', () => {
  it('defaults source to MANUAL (BR3.2)', () => {
    const { success, data } = EmployeeItemSchema.safeParse({
      id: 'emp-1',
      orgId: 'org-123',
      name: 'Jane Smith',
    });
    expect(success).toBe(true);
    expect(data?.source).toBe('MANUAL');
  });

  it('accepts AI_IMPORT provenance', () => {
    const { success, data } = EmployeeItemSchema.safeParse({
      id: 'emp-1',
      orgId: 'org-123',
      name: 'Jane Smith',
      source: 'AI_IMPORT',
    });
    expect(success).toBe(true);
    expect(data?.source).toBe('AI_IMPORT');
  });
});
