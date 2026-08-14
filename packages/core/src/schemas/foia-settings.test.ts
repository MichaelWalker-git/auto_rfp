import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOIA_APPROVAL_REMINDER_DAYS,
  DEFAULT_FOIA_DAILY_SEND_CAP,
  DEFAULT_FOIA_REQUESTED_DOCUMENTS,
  DEFAULT_FOIA_STALL_AFTER_DAYS,
  FoiaSettingsItemSchema,
  FoiaSettingsSchema,
  FoiaSettingsUpdateRequestSchema,
  buildDefaultFoiaSettings,
} from './foia-settings';
import { DEFAULT_FOIA_DELAY_DAYS } from './foia-automation';
import { FOIA_DOCUMENT_TYPES } from './foia';

describe('FoiaSettingsSchema defaults', () => {
  it('enables automation by default', () => {
    // Scheduling and preparation are safe without opt-in because nothing is
    // transmitted without an explicit approval.
    const { success, data } = FoiaSettingsSchema.safeParse({});

    expect(success).toBe(true);
    expect(data?.automationEnabled).toBe(true);
  });

  it('defaults the delay to 90 days', () => {
    const { data } = FoiaSettingsSchema.safeParse({});

    expect(data?.delayDays).toBe(DEFAULT_FOIA_DELAY_DAYS);
    expect(data?.delayDays).toBe(90);
  });

  it('leaves the Level 1 mail scrape off by default', () => {
    const { data } = FoiaSettingsSchema.safeParse({});

    expect(data?.mailScrapeEnabled).toBe(false);
  });

  it('applies the documented default reminder ladder, stall threshold and cap', () => {
    const { data } = FoiaSettingsSchema.safeParse({});

    expect(data?.approvalReminderDays).toEqual([...DEFAULT_FOIA_APPROVAL_REMINDER_DAYS]);
    expect(data?.stallAfterDays).toBe(DEFAULT_FOIA_STALL_AFTER_DAYS);
    expect(data?.dailySendCap).toBe(DEFAULT_FOIA_DAILY_SEND_CAP);
  });

  it('defaults the requested documents to the common post-award set', () => {
    const { data } = FoiaSettingsSchema.safeParse({});

    expect(data?.defaultRequestedDocuments).toEqual([...DEFAULT_FOIA_REQUESTED_DOCUMENTS]);
  });

  it('only defaults to real FOIA document types', () => {
    for (const docType of DEFAULT_FOIA_REQUESTED_DOCUMENTS) {
      expect(FOIA_DOCUMENT_TYPES).toContain(docType);
    }
  });

  it('asks for a fee waiver by default', () => {
    const { data } = FoiaSettingsSchema.safeParse({});

    // The letter generator treats feeLimit 0 as "request a fee waiver".
    expect(data?.defaultFeeLimit).toBe(0);
  });
});

describe('FoiaSettingsSchema validation', () => {
  it('rejects a non-email scrape mailbox', () => {
    const { success } = FoiaSettingsSchema.safeParse({ scrapeMailbox: 'not-an-email' });

    expect(success).toBe(false);
  });

  it('accepts a null scrape mailbox', () => {
    const { success } = FoiaSettingsSchema.safeParse({ scrapeMailbox: null });

    expect(success).toBe(true);
  });

  it('rejects a negative delay', () => {
    expect(FoiaSettingsSchema.safeParse({ delayDays: -1 }).success).toBe(false);
  });

  it('rejects a delay beyond ten years', () => {
    expect(FoiaSettingsSchema.safeParse({ delayDays: 4000 }).success).toBe(false);
  });

  it('accepts a zero delay for same-day sending', () => {
    expect(FoiaSettingsSchema.safeParse({ delayDays: 0 }).success).toBe(true);
  });

  it('rejects an empty requested-documents list', () => {
    expect(FoiaSettingsSchema.safeParse({ defaultRequestedDocuments: [] }).success).toBe(false);
  });

  it('rejects an unknown document type', () => {
    expect(
      FoiaSettingsSchema.safeParse({ defaultRequestedDocuments: ['NOT_A_DOC_TYPE'] }).success,
    ).toBe(false);
  });

  it('rejects a negative fee limit', () => {
    expect(FoiaSettingsSchema.safeParse({ defaultFeeLimit: -5 }).success).toBe(false);
  });

  it('rejects a daily send cap of zero', () => {
    // A cap of zero would silently disable sending; use automationEnabled for that.
    expect(FoiaSettingsSchema.safeParse({ dailySendCap: 0 }).success).toBe(false);
  });

  it('rejects a stall threshold of zero days', () => {
    expect(FoiaSettingsSchema.safeParse({ stallAfterDays: 0 }).success).toBe(false);
  });
});

describe('FoiaSettingsUpdateRequestSchema', () => {
  it('accepts an empty patch', () => {
    expect(FoiaSettingsUpdateRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a single-field patch without applying defaults for the rest', () => {
    const { success, data } = FoiaSettingsUpdateRequestSchema.safeParse({ delayDays: 45 });

    expect(success).toBe(true);
    expect(data?.delayDays).toBe(45);
    // A partial patch must not silently reset other settings to defaults.
    expect(data?.dailySendCap).toBeUndefined();
    expect(data?.automationEnabled).toBeUndefined();
  });

  it('still validates the fields it is given', () => {
    expect(FoiaSettingsUpdateRequestSchema.safeParse({ delayDays: -1 }).success).toBe(false);
  });

  it('allows turning automation off as a kill switch', () => {
    const { success, data } = FoiaSettingsUpdateRequestSchema.safeParse({
      automationEnabled: false,
    });

    expect(success).toBe(true);
    expect(data?.automationEnabled).toBe(false);
  });
});

describe('buildDefaultFoiaSettings', () => {
  it('returns a fully-populated settings object for an org with no record', () => {
    const settings = buildDefaultFoiaSettings('org-123');

    expect(settings.orgId).toBe('org-123');
    expect(settings.automationEnabled).toBe(true);
    expect(settings.delayDays).toBe(DEFAULT_FOIA_DELAY_DAYS);
    expect(settings.dailySendCap).toBe(DEFAULT_FOIA_DAILY_SEND_CAP);
    expect(settings.defaultRequestedDocuments.length).toBeGreaterThan(0);
  });

  it('produces an object that round-trips through the item schema', () => {
    const settings = buildDefaultFoiaSettings('org-123');

    expect(FoiaSettingsItemSchema.safeParse(settings).success).toBe(true);
  });

  it('has no approver configured by default, so the send path must fall back', () => {
    const settings = buildDefaultFoiaSettings('org-123');

    expect(settings.approverUserId ?? null).toBeNull();
  });
});
