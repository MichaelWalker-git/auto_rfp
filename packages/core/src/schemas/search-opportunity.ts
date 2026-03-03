/**
 * search-opportunity.ts
 *
 * All types related to SEARCHING for opportunities across any source,
 * plus saved-search and import-request types for SAM.gov and DIBBS.
 *
 * Stored / imported opportunities live in opportunity.ts.
 */

import { z } from 'zod';
import { OpportunitySourceSchema } from './opportunity';

// ─── Shared date helper ───────────────────────────────────────────────────────

export const MmDdYyyySchema = z
  .string()
  .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy');

export type MmDdYyyy = z.infer<typeof MmDdYyyySchema>;

export const DollarRangeSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .optional();

// ═══════════════════════════════════════════════════════════════════════════════
// SAM.GOV
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SAM.gov slim result ──────────────────────────────────────────────────────

export const SamOpportunitySlimSchema = z.object({
  noticeId:           z.string().optional(),
  solicitationNumber: z.string().optional(),
  title:              z.string().optional(),
  type:               z.string().optional(),
  postedDate:         z.string().optional(),
  responseDeadLine:   z.string().optional(),
  naicsCode:          z.string().optional(),
  classificationCode: z.string().optional(),
  active:             z.union([z.string(), z.boolean()]).optional(),
  setAside:           z.string().optional(),
  setAsideCode:       z.string().optional(),
  fullParentPathName: z.string().optional(),
  fullParentPathCode: z.string().optional(),
  description:        z.string().optional(),
  baseAndAllOptionsValue: z.number().optional(),
  award:              z.any().optional(),
  attachmentsCount:   z.number().int().nonnegative().optional(),
});

export type SamOpportunitySlim = z.infer<typeof SamOpportunitySlimSchema>;

// ─── Unified search request (usable for SAM.gov, DIBBS, and future sources) ──

export const LoadSearchOpportunitiesRequestSchema = z.object({
  // ── Date filters (MM/dd/yyyy) ──────────────────────────────────────────────
  /** Posted-from date (MM/dd/yyyy). Required for SAM.gov; optional for DIBBS. */
  postedFrom: MmDdYyyySchema.optional(),
  /** Posted-to date (MM/dd/yyyy). Required for SAM.gov; optional for DIBBS. */
  postedTo:   MmDdYyyySchema.optional(),
  /** Response-deadline from (MM/dd/yyyy). SAM.gov `rdlfrom`. */
  rdlfrom:    MmDdYyyySchema.optional(),
  /** Closing-from date (MM/dd/yyyy). DIBBS `closingFrom`. */
  closingFrom: MmDdYyyySchema.optional(),
  /** Closing-to date (MM/dd/yyyy). DIBBS `closingTo`. */
  closingTo:   MmDdYyyySchema.optional(),

  // ── Text search ───────────────────────────────────────────────────────────
  keywords:   z.string().min(1).optional(),
  title:      z.string().min(1).optional(),

  // ── Classification ────────────────────────────────────────────────────────
  /** NAICS codes (e.g. ["541511", "562111"]). Supported by both SAM.gov and DIBBS. */
  naics:      z.array(z.string().min(2)).optional(),
  /** PSC / classification codes. Supported by both SAM.gov and DIBBS. */
  psc:        z.array(z.string().min(2)).optional(),
  setAsideCode: z.string().optional(),

  // ── Organization / agency ─────────────────────────────────────────────────
  /** SAM.gov organization code. */
  organizationCode: z.string().optional(),
  /** SAM.gov organization name / DIBBS dodComponent filter. */
  organizationName: z.string().optional(),

  // ── SAM.gov-specific ──────────────────────────────────────────────────────
  /** SAM.gov procurement type codes (e.g. ["o", "p"]). */
  ptype:  z.array(z.string()).optional(),
  state:  z.string().optional(),
  zip:    z.string().optional(),

  // ── DIBBS-specific ────────────────────────────────────────────────────────
  technologyAreas:  z.array(z.string().min(1)).optional(),
  dodComponents:    z.array(z.string().min(1)).optional(),
  contractVehicles: z.array(z.string().min(1)).optional(),
  innovationTopics: z.array(z.string().min(1)).optional(),
  solicitationNumber: z.string().min(1).optional(),

  // ── Value range ───────────────────────────────────────────────────────────
  dollarRange: DollarRangeSchema,

  // ── Pagination ────────────────────────────────────────────────────────────
  limit:  z.number().int().positive().max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

export type LoadSearchOpportunitiesRequest = z.infer<typeof LoadSearchOpportunitiesRequestSchema>;

/**
 * @deprecated Use LoadSearchOpportunitiesRequestSchema instead.
 * Kept for backward compatibility with existing SAM.gov-specific code.
 */
export const LoadSamOpportunitiesRequestSchema = LoadSearchOpportunitiesRequestSchema.extend({
  postedFrom: MmDdYyyySchema,
  postedTo:   MmDdYyyySchema,
});

export type LoadSamOpportunitiesRequest = z.infer<typeof LoadSamOpportunitiesRequestSchema>;

export const LoadSamOpportunitiesResponseSchema = z.object({
  totalRecords:  z.number().int().nonnegative(),
  limit:         z.number().int().nonnegative(),
  offset:        z.number().int().nonnegative(),
  opportunities: z.array(SamOpportunitySlimSchema),
});

export type LoadSamOpportunitiesResponse = z.infer<typeof LoadSamOpportunitiesResponseSchema>;

// ─── SAM.gov saved search ─────────────────────────────────────────────────────

export const SavedSearchFrequencySchema = z.enum(['HOURLY', 'DAILY', 'WEEKLY']);
export type SavedSearchFrequency = z.infer<typeof SavedSearchFrequencySchema>;

/** Which integration this saved search belongs to */
export const SavedSearchSourceSchema = z.enum(['SAM_GOV', 'DIBBS']);
export type SavedSearchSource = z.infer<typeof SavedSearchSourceSchema>;

export const SavedSearchSchema = z.object({
  savedSearchId: z.string().min(1),
  orgId:         z.string().min(1),
  /** Integration source — determines which API is called when the search runs */
  source:        SavedSearchSourceSchema.default('SAM_GOV'),
  name:          z.string().min(1).max(120),
  criteria:      LoadSearchOpportunitiesRequestSchema,
  frequency:     SavedSearchFrequencySchema.default('DAILY'),
  autoImport:    z.boolean().default(false),
  notifyEmails:  z.array(z.string().email()).default([]),
  isEnabled:     z.boolean().default(true),
  lastRunAt:     z.string().datetime().nullable().default(null),
  createdAt:     z.string().datetime(),
  updatedAt:     z.string().datetime(),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const CreateSavedSearchRequestSchema = z.object({
  orgId:        z.string().min(1),
  /** Integration source — SAM_GOV or DIBBS */
  source:       SavedSearchSourceSchema.default('SAM_GOV'),
  name:         z.string().min(1).max(120),
  criteria:     LoadSearchOpportunitiesRequestSchema,
  frequency:    SavedSearchFrequencySchema.optional(),
  autoImport:   z.boolean().optional(),
  notifyEmails: z.array(z.string().email()).optional(),
  isEnabled:    z.boolean().optional(),
});

export type CreateSavedSearchRequest = z.infer<typeof CreateSavedSearchRequestSchema>;

export const CreateSavedSearchResponseSchema = SavedSearchSchema;
export type CreateSavedSearchResponse = z.infer<typeof CreateSavedSearchResponseSchema>;

export const PatchSchema = z
  .object({
    name:         z.string().min(1).max(120).optional(),
    criteria:     LoadSearchOpportunitiesRequestSchema.optional(),
    frequency:    SavedSearchFrequencySchema.optional(),
    autoImport:   z.boolean().optional(),
    notifyEmails: z.array(z.string().email()).optional(),
    isEnabled:    z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Patch body is required' });

export type PatchType = z.infer<typeof PatchSchema>;

// ─── SAM.gov import request ───────────────────────────────────────────────────

export const ImportSolicitationRequestSchema = z.object({
  orgId:            z.string().optional(),
  projectId:        z.string().optional(),
  noticeId:         z.string().optional(),
  postedFrom:       z.string().optional(),
  postedTo:         z.string().optional(),
  sourceDocumentId: z.string().optional(),
});

export type ImportSolicitationRequest = z.infer<typeof ImportSolicitationRequestSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// DIBBS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DIBBS slim result ────────────────────────────────────────────────────────

export const DibbsDollarRangeSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .optional();

export const DibbsOpportunitySlimSchema = z.object({
  solicitationNumber:     z.string().optional(),
  title:                  z.string().optional(),
  type:                   z.string().optional(),
  postedDate:             z.string().optional(),
  closingDate:            z.string().optional(),
  naicsCode:              z.string().optional(),
  pscCode:                z.string().optional(),
  dodComponent:           z.string().optional(),
  contractVehicle:        z.string().optional(),
  technologyArea:         z.string().optional(),
  setAside:               z.string().optional(),
  setAsideCode:           z.string().optional(),
  description:            z.string().optional(),
  active:                 z.union([z.string(), z.boolean()]).optional(),
  baseAndAllOptionsValue: z.number().optional(),
  attachmentsCount:       z.number().int().nonnegative().optional(),
  url:                    z.string().url().optional(),
});

export type DibbsOpportunitySlim = z.infer<typeof DibbsOpportunitySlimSchema>;

// ─── DIBBS search request / response ─────────────────────────────────────────

export const SearchDibbsOpportunitiesRequestSchema = z.object({
  keywords:           z.string().min(1).optional(),
  technologyAreas:    z.array(z.string().min(1)).optional(),
  dodComponents:      z.array(z.string().min(1)).optional(),
  contractVehicles:   z.array(z.string().min(1)).optional(),
  innovationTopics:   z.array(z.string().min(1)).optional(),
  solicitationNumber: z.string().min(1).optional(),
  setAsideCode:       z.string().optional(),
  naics:              z.array(z.string().min(2)).optional(),
  psc:                z.array(z.string().min(2)).optional(),
  postedFrom:  z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy').optional(),
  postedTo:    z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy').optional(),
  closingFrom: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy').optional(),
  closingTo:   z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy').optional(),
  dollarRange: DibbsDollarRangeSchema,
  limit:  z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export type SearchDibbsOpportunitiesRequest = z.infer<typeof SearchDibbsOpportunitiesRequestSchema>;

export const SearchDibbsOpportunitiesResponseSchema = z.object({
  totalRecords:  z.number().int().nonnegative(),
  limit:         z.number().int().nonnegative(),
  offset:        z.number().int().nonnegative(),
  opportunities: z.array(DibbsOpportunitySlimSchema),
});

export type SearchDibbsOpportunitiesResponse = z.infer<typeof SearchDibbsOpportunitiesResponseSchema>;

// ─── DIBBS saved search ───────────────────────────────────────────────────────

export const DibbsSavedSearchFrequencySchema = z.enum(['HOURLY', 'DAILY', 'WEEKLY']);

export const DibbsSavedSearchSchema = z.object({
  savedSearchId: z.string().min(1),
  orgId:         z.string().min(1),
  name:          z.string().min(1).max(120),
  criteria:      SearchDibbsOpportunitiesRequestSchema,
  frequency:     DibbsSavedSearchFrequencySchema.default('DAILY'),
  autoImport:    z.boolean().default(false),
  notifyEmails:  z.array(z.string().email()).default([]),
  isEnabled:     z.boolean().default(true),
  lastRunAt:     z.string().datetime().nullable().default(null),
  createdAt:     z.string().datetime(),
  updatedAt:     z.string().datetime(),
});

export type DibbsSavedSearch = z.infer<typeof DibbsSavedSearchSchema>;

export const CreateDibbsSavedSearchRequestSchema = z.object({
  orgId:        z.string().min(1),
  name:         z.string().min(1).max(120),
  criteria:     SearchDibbsOpportunitiesRequestSchema,
  frequency:    DibbsSavedSearchFrequencySchema.optional(),
  autoImport:   z.boolean().optional(),
  notifyEmails: z.array(z.string().email()).optional(),
  isEnabled:    z.boolean().optional(),
});


export const PatchDibbsSavedSearchSchema = z
  .object({
    name:         z.string().min(1).max(120).optional(),
    criteria:     SearchDibbsOpportunitiesRequestSchema.optional(),
    frequency:    DibbsSavedSearchFrequencySchema.optional(),
    autoImport:   z.boolean().optional(),
    notifyEmails: z.array(z.string().email()).optional(),
    isEnabled:    z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Patch body must not be empty' });

export type PatchDibbsSavedSearch = z.infer<typeof PatchDibbsSavedSearchSchema>;

// ─── DIBBS import request ─────────────────────────────────────────────────────

export const ImportDibbsSolicitationRequestSchema = z.object({
  orgId:              z.string().min(1),
  projectId:          z.string().min(1),
  solicitationNumber: z.string().min(1),
  sourceDocumentId:   z.string().optional(),
});

export type ImportDibbsSolicitationRequest = z.infer<typeof ImportDibbsSolicitationRequestSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED (cross-source)
// ═══════════════════════════════════════════════════════════════════════════════

export const SearchOpportunitySlimSchema = z.object({
  /** Unique identifier — noticeId for SAM.gov, solicitationNumber for DIBBS */
  id:                     z.string(),
  source:                 OpportunitySourceSchema,
  solicitationNumber:     z.string().nullable(),
  noticeId:               z.string().nullable(),
  title:                  z.string(),
  /** SOLICITATION, PRESOLICITATION, SOURCES_SOUGHT, etc. */
  type:                   z.string().nullable(),
  postedDate:             z.string().nullable(),
  /** responseDeadLine (SAM.gov) or closingDate (DIBBS) */
  closingDate:            z.string().nullable(),
  naicsCode:              z.string().nullable(),
  /** fullParentPathName (SAM.gov) or dodComponent (DIBBS) */
  organizationName:       z.string().nullable(),
  /** SBIR, OTA, IDIQ, etc. — DIBBS only; null for SAM.gov */
  contractVehicle:        z.string().nullable(),
  /** Small Business, 8(a), SDVOSB, etc. */
  setAside:               z.string().nullable(),
  /** Technology / innovation area — DIBBS only; null for SAM.gov */
  technologyArea:         z.string().nullable(),
  description:            z.string().nullable(),
  active:                 z.boolean(),
  baseAndAllOptionsValue: z.number().nullable(),
  attachmentsCount:       z.number().int().nonnegative(),
  url:                    z.string().nullable(),
  /** SAM.gov description URL — pass to the description endpoint to fetch full text */
  descriptionUrl:         z.string().nullable(),
});

export type SearchOpportunitySlim = z.infer<typeof SearchOpportunitySlimSchema>;

export const SearchOpportunityResponseSchema = z.object({
  source:        OpportunitySourceSchema,
  totalRecords:  z.number().int().nonnegative(),
  limit:         z.number().int().nonnegative(),
  offset:        z.number().int().nonnegative(),
  opportunities: z.array(SearchOpportunitySlimSchema),
});

export type SearchOpportunityResponse = z.infer<typeof SearchOpportunityResponseSchema>;

// ─── Mappers ──────────────────────────────────────────────────────────────────

const toBool = (v: string | boolean | undefined): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return ['true', 't', 'yes', 'y', '1', 'active'].includes(s);
  }
  return false;
};

const isSamGovUrl = (s?: string): boolean => {
  if (!s) return false;
  try { return new URL(s).hostname.endsWith('sam.gov'); } catch { return false; }
};

export const samSlimToSearchOpportunity = (o: SamOpportunitySlim): SearchOpportunitySlim => ({
  id:                     o.noticeId ?? o.solicitationNumber ?? '',
  source:                 'SAM_GOV',
  solicitationNumber:     o.solicitationNumber ?? null,
  noticeId:               o.noticeId ?? null,
  title:                  o.title ?? '',
  type:                   o.type ?? null,
  postedDate:             o.postedDate ?? null,
  closingDate:            o.responseDeadLine ?? null,
  naicsCode:              o.naicsCode ?? null,
  organizationName:       o.fullParentPathName ?? null,
  contractVehicle:        null,
  setAside:               o.setAside ?? null,
  technologyArea:         null,
  // description field from SAM.gov is a URL to the full description
  description:            isSamGovUrl(o.description) ? null : (o.description ?? null),
  descriptionUrl:         isSamGovUrl(o.description) ? (o.description ?? null) : null,
  active:                 toBool(o.active),
  baseAndAllOptionsValue: o.baseAndAllOptionsValue ?? null,
  attachmentsCount:       o.attachmentsCount ?? 0,
  url:                    null,
});

export const dibbsSlimToSearchOpportunity = (o: DibbsOpportunitySlim): SearchOpportunitySlim => ({
  id:                     o.solicitationNumber ?? '',
  source:                 'DIBBS',
  solicitationNumber:     o.solicitationNumber ?? null,
  noticeId:               null,
  title:                  o.title ?? '',
  type:                   o.type ?? null,
  postedDate:             o.postedDate ?? null,
  closingDate:            o.closingDate ?? null,
  naicsCode:              o.naicsCode ?? null,
  organizationName:       o.dodComponent ?? null,
  contractVehicle:        o.contractVehicle ?? null,
  setAside:               o.setAside ?? null,
  technologyArea:         o.technologyArea ?? null,
  description:            o.description ?? null,
  descriptionUrl:         null,
  active:                 toBool(o.active),
  baseAndAllOptionsValue: o.baseAndAllOptionsValue ?? null,
  attachmentsCount:       o.attachmentsCount ?? 0,
  url:                    o.url ?? null,
});
