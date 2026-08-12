import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants';
import { FOIADocumentTypeSchema } from './foia';
import { DEFAULT_FOIA_DELAY_DAYS } from './foia-automation';

/**
 * Per-organization configuration for automatic FOIA requests.
 *
 * Stored as its own entity rather than as flat fields on the organization,
 * following the OrgPrimaryContact precedent: `editOrganization` needs a
 * hand-written branch per field, and `OrganizationUpdateRequestSchema` is a
 * `.partial()` of the *create* schema, which would also make every setting
 * assignable at org-creation time.
 */

/** Document types requested by default when the system composes a FOIA. */
export const DEFAULT_FOIA_REQUESTED_DOCUMENTS = [
  'SSDD',
  'TECHNICAL_EVAL',
  'PRICE_ANALYSIS',
  'PAST_PERFORMANCE_EVAL',
  'AWARD_NOTICE',
] as const;

/** Days after the approval request at which reminder emails are sent. */
export const DEFAULT_FOIA_APPROVAL_REMINDER_DAYS = [3, 7] as const;

/** Days after which an unapproved request is marked STALLED. */
export const DEFAULT_FOIA_STALL_AFTER_DAYS = 14;

/** Maximum automatic sends per organization per UTC day. */
export const DEFAULT_FOIA_DAILY_SEND_CAP = 5;

export const FoiaSettingsSchema = z.object({
  /**
   * Master switch. Defaults ON: scheduling and preparation are safe because
   * nothing leaves the system without an explicit approval click.
   */
  automationEnabled: z.boolean().default(true),

  /** Days after the submission anchor before the FOIA becomes due. */
  delayDays: z.number().int().min(0).max(3650).default(DEFAULT_FOIA_DELAY_DAYS),

  /** Level 1: the mailbox scanned daily for award / cancellation notices. */
  scrapeMailbox: z.string().email().nullish(),

  /** Level 1 on/off, independent of the Level 2 timer. */
  mailScrapeEnabled: z.boolean().default(false),

  /**
   * Transmit without a human click when the recipient came from a TRUSTED source
   * (see TRUSTED_FOIA_RECIPIENT_SOURCES). Untrusted recipients always require
   * approval regardless of this flag.
   *
   * Defaults OFF, and must stay off until the sending domain can actually reach
   * these recipients. As of writing, horustech.dev publishes
   * `v=spf1 include:_spf.google.com ~all` (which does not authorize SES) with
   * `aspf=s; adkim=s`, and has no SES DKIM record — while army.mil, navy.mil,
   * state.gov and gsa.gov are all at DMARC `p=reject`. Enabling this before
   * DKIM, an aligned SPF, a custom MAIL FROM subdomain and bounce handling are
   * in place would mark requests SENT that were silently rejected, which is
   * worse than not sending: the deadline passes with the system reporting
   * success.
   */
  autoSendTrusted: z.boolean().default(false),

  /**
   * Who approves sends. When unset, the send path falls back to the
   * opportunity assignee, then the org primary contact, then org admins.
   */
  approverUserId: z.string().nullish(),

  /** Escalating reminder schedule for an unapproved request. */
  approvalReminderDays: z
    .array(z.number().int().min(1).max(365))
    .default([...DEFAULT_FOIA_APPROVAL_REMINDER_DAYS]),

  /** When an unapproved request becomes a visible failure. */
  stallAfterDays: z.number().int().min(1).max(365).default(DEFAULT_FOIA_STALL_AFTER_DAYS),

  /** Document types the composed request asks for. */
  defaultRequestedDocuments: z
    .array(FOIADocumentTypeSchema)
    .min(1)
    .default([...DEFAULT_FOIA_REQUESTED_DOCUMENTS]),

  /** Fee ceiling on composed requests. 0 asks for a fee waiver. */
  defaultFeeLimit: z.number().nonnegative().default(0),

  /** Blast-radius guard on automated sending. */
  dailySendCap: z.number().int().min(1).max(100).default(DEFAULT_FOIA_DAILY_SEND_CAP),
});

export type FoiaSettings = z.infer<typeof FoiaSettingsSchema>;

// ─── 1. Create request ────────────────────────────────────────────────────────

export const FoiaSettingsCreateRequestSchema = FoiaSettingsSchema.extend({
  orgId: z.string().min(1),
});

export type FoiaSettingsCreateRequest = z.infer<typeof FoiaSettingsCreateRequestSchema>;

// ─── 2. Update request ────────────────────────────────────────────────────────

export const FoiaSettingsUpdateRequestSchema = FoiaSettingsSchema.partial();

export type FoiaSettingsUpdateRequest = z.infer<typeof FoiaSettingsUpdateRequestSchema>;

// ─── 3. Item ──────────────────────────────────────────────────────────────────

export const FoiaSettingsItemSchema = FoiaSettingsSchema.extend({
  orgId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type FoiaSettingsItem = z.infer<typeof FoiaSettingsItemSchema>;

// ─── 4. DB item ───────────────────────────────────────────────────────────────

export const FoiaSettingsDBItemSchema = FoiaSettingsItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});

export type FoiaSettingsDBItem = z.infer<typeof FoiaSettingsDBItemSchema>;

// ─── 5. List item ─────────────────────────────────────────────────────────────

/**
 * Settings are a singleton per org, so there is no real list view. Defined for
 * interface consistency with the 5-type entity pattern and used by the settings
 * card's summary row.
 */
export const FoiaSettingsListItemSchema = z.object({
  orgId: z.string().min(1),
  automationEnabled: z.boolean(),
  delayDays: z.number(),
  mailScrapeEnabled: z.boolean(),
  scrapeMailbox: z.string().nullish(),
});

export type FoiaSettingsListItem = z.infer<typeof FoiaSettingsListItemSchema>;

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * The effective settings for an org with no stored record.
 * Parsed through the schema so the defaults stay defined in exactly one place.
 */
export const buildDefaultFoiaSettings = (orgId: string): FoiaSettingsItem =>
  FoiaSettingsItemSchema.parse({ orgId });

// ─── API response ─────────────────────────────────────────────────────────────

export const FoiaSettingsResponseSchema = z.object({
  settings: FoiaSettingsItemSchema,
});

export type FoiaSettingsResponse = z.infer<typeof FoiaSettingsResponseSchema>;
