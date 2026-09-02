import { describe, it, expect } from 'vitest';
import { NotificationTypeSchema, NotificationPayloadSchema } from './notification';

describe('NotificationTypeSchema — NOTARY_REQUIRED (u2)', () => {
  it('accepts the new NOTARY_REQUIRED type', () => {
    expect(NotificationTypeSchema.safeParse('NOTARY_REQUIRED').success).toBe(true);
  });

  it('still accepts a pre-existing type', () => {
    expect(NotificationTypeSchema.safeParse('PROCESSING_COMPLETE').success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(NotificationTypeSchema.safeParse('NOTARY_MAYBE').success).toBe(false);
  });

  it('is usable as a NotificationPayload type', () => {
    const { success } = NotificationPayloadSchema.safeParse({
      type: 'NOTARY_REQUIRED',
      title: 'Notary requirement detected',
      message: '3 of 6 form(s) may require notarization.',
      recipientUserIds: ['11111111-1111-1111-1111-111111111111'],
      orgId: '22222222-2222-2222-2222-222222222222',
    });
    expect(success).toBe(true);
  });
});
