import { describe, it, expect } from 'vitest';
import {
  OrganizationItemSchema,
  OrganizationListItemSchema,
} from './organization';

describe('OrganizationItemSchema — enableSolutionPlan', () => {
  const validOrg = {
    id: 'org-123',
    name: 'Acme GovCon',
  };

  it('parses a valid organization without the flag (optional, no default)', () => {
    const { success, data } = OrganizationItemSchema.safeParse(validOrg);
    expect(success).toBe(true);
    expect(data?.enableSolutionPlan).toBeUndefined();
  });

  it.each([true, false])('accepts enableSolutionPlan: %s', (flag) => {
    const { success, data } = OrganizationItemSchema.safeParse({
      ...validOrg,
      enableSolutionPlan: flag,
    });
    expect(success).toBe(true);
    expect(data?.enableSolutionPlan).toBe(flag);
  });

  it('rejects a non-boolean enableSolutionPlan', () => {
    const { success, error } = OrganizationItemSchema.safeParse({
      ...validOrg,
      enableSolutionPlan: 'yes',
    });
    expect(success).toBe(false);
    expect(error?.issues[0]?.path).toEqual(['enableSolutionPlan']);
  });
});

describe('OrganizationListItemSchema — enableSolutionPlan', () => {
  const validListItem = {
    id: 'org-123',
    name: 'Acme GovCon',
  };

  it('parses without the flag', () => {
    const { success } = OrganizationListItemSchema.safeParse(validListItem);
    expect(success).toBe(true);
  });

  it('carries the flag for org switchers/selectors, like enableComplianceReview', () => {
    const { success, data } = OrganizationListItemSchema.safeParse({
      ...validListItem,
      enableSolutionPlan: true,
      enableComplianceReview: true,
    });
    expect(success).toBe(true);
    expect(data?.enableSolutionPlan).toBe(true);
  });

  it('rejects a non-boolean enableSolutionPlan', () => {
    const { success } = OrganizationListItemSchema.safeParse({
      ...validListItem,
      enableSolutionPlan: 1,
    });
    expect(success).toBe(false);
  });
});
