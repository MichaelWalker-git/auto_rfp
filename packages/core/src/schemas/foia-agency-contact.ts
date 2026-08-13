import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants';
import { JurisdictionSchema } from './foia';
import { normalizeAgencyTitle } from './foia-component';

/**
 * An organization's own directory of agency FOIA / public-records contacts.
 *
 * Built up by use rather than shipped as seed data: whenever a user confirms a
 * recipient for an agency, it is written here and reused for every future
 * opportunity with that agency, so no agency is ever asked about twice.
 */

/**
 * Normalizes an agency name into a stable directory key.
 *
 * Delegates to `normalizeAgencyTitle` so the org directory and the FOIA.gov
 * matcher agree byte-for-byte. They must: this is the lookup key for an address a
 * human confirmed, and a weaker normalizer here would mean a user who confirmed
 * "DEPT OF THE ARMY" gets asked again for "Department of the Army" — the saved
 * answer silently stops applying.
 *
 * Matching is intentionally EXACT on this key — no fuzzy or token-similarity
 * fallback. Sibling components often have near-identical names, and a fuzzy hit
 * would confidently send a statutory request to the wrong office. A near-miss
 * falls through and asks the user instead.
 */
export const normalizeAgencyKey = (agencyName: string): string =>
  normalizeAgencyTitle(agencyName.normalize('NFKD'));

// ─── 1. Create request ────────────────────────────────────────────────────────

export const FoiaAgencyContactCreateRequestSchema = z.object({
  orgId: z.string().min(1),
  /** Display name as it appeared on the opportunity. */
  agencyName: z.string().trim().min(1, 'Agency name is required'),
  foiaEmail: z.string().email('Valid FOIA email is required').nullish(),
  foiaAddress: z.string().trim().min(1, 'FOIA mailing address is required').nullish(),
  /** False for agencies that only accept portal or postal submissions. */
  acceptsEmail: z.boolean().default(true),
  webPortalUrl: z.string().url().nullish(),
  jurisdiction: JurisdictionSchema.nullish(),
  state: z.string().nullish(),
  notes: z.string().max(1000).nullish(),
});

export type FoiaAgencyContactCreateRequest = z.infer<typeof FoiaAgencyContactCreateRequestSchema>;

// ─── 2. Update request ────────────────────────────────────────────────────────

export const FoiaAgencyContactUpdateRequestSchema = FoiaAgencyContactCreateRequestSchema
  .partial()
  .omit({ orgId: true });

export type FoiaAgencyContactUpdateRequest = z.infer<typeof FoiaAgencyContactUpdateRequestSchema>;

// ─── 3. Item ──────────────────────────────────────────────────────────────────

export const FoiaAgencyContactItemSchema = FoiaAgencyContactCreateRequestSchema.extend({
  /** Normalized `agencyName`; the second SK segment. */
  agencyKey: z.string().min(1),
  /**
   * When the contact was last confirmed to work. Set on creation and on any
   * successful send; a bounce clears `acceptsEmail` so a dead mailbox cannot
   * silently swallow every future request to this agency.
   */
  verifiedAt: z.string().datetime({ offset: true }).nullish(),
  /** Set by the bounce handler so the UI can explain why it needs re-entry. */
  lastBounceReason: z.string().nullish(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type FoiaAgencyContactItem = z.infer<typeof FoiaAgencyContactItemSchema>;

// ─── 4. DB item ───────────────────────────────────────────────────────────────

export const FoiaAgencyContactDBItemSchema = FoiaAgencyContactItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});

export type FoiaAgencyContactDBItem = z.infer<typeof FoiaAgencyContactDBItemSchema>;

// ─── 5. List item ─────────────────────────────────────────────────────────────

export const FoiaAgencyContactListItemSchema = z.object({
  agencyKey: z.string(),
  agencyName: z.string(),
  foiaEmail: z.string().nullish(),
  acceptsEmail: z.boolean().optional(),
  webPortalUrl: z.string().nullish(),
  verifiedAt: z.string().nullish(),
});

export type FoiaAgencyContactListItem = z.infer<typeof FoiaAgencyContactListItemSchema>;

// ─── API responses ────────────────────────────────────────────────────────────

export const FoiaAgencyContactsResponseSchema = z.object({
  contacts: z.array(FoiaAgencyContactItemSchema),
});

export type FoiaAgencyContactsResponse = z.infer<typeof FoiaAgencyContactsResponseSchema>;

/**
 * Confirms the recipient for a blocked automation — either by picking one of the
 * candidates the document scan surfaced, or by typing an address directly. The
 * confirmed value is written back to the org directory.
 */
export const ConfirmFoiaRecipientSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  foiaEmail: z.string().email('Valid FOIA email is required'),
  foiaAddress: z.string().trim().min(1, 'FOIA mailing address is required'),
  /** Persist to the org directory for reuse. Defaults true. */
  saveToDirectory: z.boolean().default(true),
});

export type ConfirmFoiaRecipient = z.infer<typeof ConfirmFoiaRecipientSchema>;

/**
 * Adds solicitation-specific document requests to a prepared FOIA request.
 *
 * The automated path composes a standardized list of documents, which is correct
 * but generic. A specialist reading the solicitation asks for named artifacts —
 * "the Section 4.3 scoring worksheets", "the bid tabulation with SB preference
 * computations" — and those requests are what actually get honoured, because they
 * name records the agency can locate.
 *
 * Rather than trying to infer them, this lets a reviewer add them at the approval
 * step, which is the one moment a human is already reading the letter.
 *
 * Editing is deliberately scoped to this ONE field. The rest of the letter is
 * derived from records that can be checked (the agency address, the award date and
 * its provenance, whether a proposal was actually submitted); making those
 * free-text here would let a reviewer assert something the app cannot substantiate
 * in a statutory filing. Additional document requests carry no such risk — the
 * worst case is the agency reporting no such record exists.
 */
export const UpdateFoiaCustomDocumentsSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  /**
   * Replaces the list wholesale rather than appending, so the UI can edit and
   * remove entries with one call. An empty array is meaningful: it clears them.
   *
   * The cap is a guard against a paste of the whole solicitation — a letter that
   * enumerates two hundred items reads as unserious and invites a "unduly
   * burdensome" denial, which is worse than asking for too little.
   */
  customDocumentRequests: z
    .array(z.string().trim().min(1, 'A document request cannot be empty').max(500))
    .max(25, 'At most 25 additional document requests'),
});

export type UpdateFoiaCustomDocuments = z.infer<typeof UpdateFoiaCustomDocumentsSchema>;
