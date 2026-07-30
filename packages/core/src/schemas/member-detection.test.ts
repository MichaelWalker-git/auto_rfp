import { describe, it, expect } from 'vitest';
import {
  MemberDetectionEventSchema,
  MemberDetectionEventTypeSchema,
} from './member-detection';
import { OrganizationItemSchema } from './organization';

describe('MemberDetectionEventTypeSchema', () => {
  it('accepts the two known event types', () => {
    expect(MemberDetectionEventTypeSchema.parse('NEW_ACCOUNT')).toBe('NEW_ACCOUNT');
    expect(MemberDetectionEventTypeSchema.parse('ADDED_TO_ORG')).toBe('ADDED_TO_ORG');
  });

  it('rejects an unknown event type', () => {
    expect(MemberDetectionEventTypeSchema.safeParse('REMOVED').success).toBe(false);
  });
});

describe('MemberDetectionEventSchema', () => {
  const valid = {
    eventType: 'NEW_ACCOUNT',
    timestamp: '2026-06-08T12:00:00.000Z',
    orgId: 'org-123',
    orgName: 'VRC',
    email: 'jane@example.com',
    firstName: 'Jane',
    role: 'ADMIN',
    userId: 'user-789',
  };

  it('parses a fully valid event', () => {
    const { success, data } = MemberDetectionEventSchema.safeParse(valid);
    expect(success).toBe(true);
    expect(data?.eventType).toBe('NEW_ACCOUNT');
  });

  it('allows firstName to be omitted', () => {
    const { firstName, ...withoutFirstName } = valid;
    expect(MemberDetectionEventSchema.safeParse(withoutFirstName).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(MemberDetectionEventSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects a non-datetime timestamp', () => {
    expect(MemberDetectionEventSchema.safeParse({ ...valid, timestamp: '2026-06-08' }).success).toBe(false);
  });

  it('rejects an unknown eventType', () => {
    expect(MemberDetectionEventSchema.safeParse({ ...valid, eventType: 'FOO' }).success).toBe(false);
  });
});

describe('OrganizationItemSchema enableMemberDetection flag', () => {
  it('defaults enableMemberDetection to false when omitted', () => {
    const { success, data } = OrganizationItemSchema.safeParse({ id: 'org-1', name: 'Acme' });
    expect(success).toBe(true);
    expect(data?.enableMemberDetection).toBe(false);
  });

  it('accepts enableMemberDetection set to true', () => {
    const { success, data } = OrganizationItemSchema.safeParse({
      id: 'org-1',
      name: 'Acme',
      enableMemberDetection: true,
    });
    expect(success).toBe(true);
    expect(data?.enableMemberDetection).toBe(true);
  });
});
