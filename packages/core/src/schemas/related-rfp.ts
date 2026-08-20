/**
 * related-rfp.ts
 *
 * Types for RELATED RFP link records (HOR-2610).
 *
 * A "related RFP" is a lightweight LINK to a past/present RFP from the same
 * solicitation organization, discovered via HigherGov. It is NOT a full imported
 * OpportunityItem — just a pointer (title, agency, dates, HigherGov URL, score).
 *
 * Links are anchored to a single imported opportunity (orgId#projectId#oppId).
 * `origin` distinguishes auto-discovered links from manual user adds.
 */

import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

// ─── Origin ─────────────────────────────────────────────────────────────────

export const RelatedRfpOriginSchema = z.enum(['AUTO', 'MANUAL']);
export type RelatedRfpOrigin = z.infer<typeof RelatedRfpOriginSchema>;

// 1. Create request — server-managed fields (id, audit) omitted.
export const RelatedRfpCreateRequestSchema = z.object({
  orgId:            z.string().min(1),
  projectId:        z.string().min(1),
  oppId:            z.string().min(1),
  /** HigherGov opp_key of the related past RFP. */
  relatedOppKey:    z.string().min(1),
  title:            z.string().min(1),
  organizationName: z.string().nullish(),
  postedDateIso:    z.string().nullish(),
  dueDateIso:       z.string().nullish(),
  /** HigherGov listing URL (used when the match is NOT already imported). */
  sourceUrl:        z.string().nullish(),
  /** 0..1 relevance score from ranking (absent for manual adds). */
  matchScore:       z.number().min(0).max(1).nullish(),
  origin:           RelatedRfpOriginSchema.default('MANUAL'),
});
export type RelatedRfpCreateRequest = z.infer<typeof RelatedRfpCreateRequestSchema>;

// 2. Update request — partial, identifiers not patchable.
export const RelatedRfpUpdateRequestSchema = RelatedRfpCreateRequestSchema
  .partial()
  .omit({ orgId: true, projectId: true, oppId: true, relatedOppKey: true });
export type RelatedRfpUpdateRequest = z.infer<typeof RelatedRfpUpdateRequestSchema>;

// 3. Item — pure domain entity (NO db keys).
export const RelatedRfpItemSchema = RelatedRfpCreateRequestSchema.extend({
  id: z.string(),
  /**
   * When the related RFP is ALREADY imported in this org, the in-app
   * OpportunityItem.oppId to deep-link to (cross-link dedup). Null → link out
   * to sourceUrl (HigherGov) instead.
   */
  linkedOpportunityId: z.string().nullish(),
  createdAt:     z.string().datetime().optional(),
  updatedAt:     z.string().datetime().optional(),
  createdBy:     z.string().optional(),
  createdByName: z.string().optional(),
});
export type RelatedRfpItem = z.infer<typeof RelatedRfpItemSchema>;

// 4. DBItem — Item + single-table keys.
export const RelatedRfpDBItemSchema = RelatedRfpItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type RelatedRfpDBItem = z.infer<typeof RelatedRfpDBItemSchema>;

// 5. ListItem — lightweight projection for the detail-page card.
export const RelatedRfpListItemSchema = z.object({
  id:                  z.string(),
  relatedOppKey:       z.string(),
  title:               z.string(),
  organizationName:    z.string().nullish(),
  postedDateIso:       z.string().nullish(),
  dueDateIso:          z.string().nullish(),
  sourceUrl:           z.string().nullish(),
  matchScore:          z.number().nullish(),
  origin:              RelatedRfpOriginSchema,
  linkedOpportunityId: z.string().nullish(),
  createdAt:           z.string().datetime().optional(),
  createdByName:       z.string().optional(),
});
export type RelatedRfpListItem = z.infer<typeof RelatedRfpListItemSchema>;

// ─── Suppression (tombstone) record ───────────────────────────────────────────
// One per (opp, removed oppKey) so a refresh never re-adds an admin-removed match.

export const RelatedRfpSuppressionItemSchema = z.object({
  orgId:         z.string(),
  projectId:     z.string(),
  oppId:         z.string(),
  relatedOppKey: z.string(),
  createdAt:     z.string().datetime().optional(),
  createdBy:     z.string().optional(),
});
export type RelatedRfpSuppressionItem = z.infer<typeof RelatedRfpSuppressionItemSchema>;

export const RelatedRfpSuppressionDBItemSchema = RelatedRfpSuppressionItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type RelatedRfpSuppressionDBItem = z.infer<typeof RelatedRfpSuppressionDBItemSchema>;

// ─── Response shapes ───────────────────────────────────────────────────────────

export const RelatedRfpsResponseSchema = z.object({
  items: z.array(RelatedRfpListItemSchema),
});
export type RelatedRfpsResponse = z.infer<typeof RelatedRfpsResponseSchema>;

export const RelatedRfpResponseSchema = z.object({ item: RelatedRfpItemSchema });
export type RelatedRfpResponse = z.infer<typeof RelatedRfpResponseSchema>;

// Manual refresh — re-run auto-discovery for one opportunity.
export const RelatedRfpRefreshRequestSchema = z.object({
  orgId:     z.string().min(1),
  projectId: z.string().min(1),
  oppId:     z.string().min(1),
});
export type RelatedRfpRefreshRequest = z.infer<typeof RelatedRfpRefreshRequestSchema>;

// ─── Agency-history search (manual-add picker) ────────────────────────────────

export const AgencyHistoryItemSchema = z.object({
  relatedOppKey:       z.string(),
  title:               z.string(),
  organizationName:    z.string().nullish(),
  postedDateIso:       z.string().nullish(),
  dueDateIso:          z.string().nullish(),
  sourceUrl:           z.string().nullish(),
  linkedOpportunityId: z.string().nullish(),
  /** True when this RFP is already linked to the current opportunity. */
  alreadyRelated:      z.boolean().default(false),
});
export type AgencyHistoryItem = z.infer<typeof AgencyHistoryItemSchema>;

export const AgencyHistoryResponseSchema = z.object({ items: z.array(AgencyHistoryItemSchema) });
export type AgencyHistoryResponse = z.infer<typeof AgencyHistoryResponseSchema>;
