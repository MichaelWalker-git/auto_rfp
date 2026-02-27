/**
 * opportunity.ts
 *
 * Types for STORED / IMPORTED opportunities — records saved to DynamoDB.
 * Search-related types live in search-opportunity.ts.
 *
 * NOTE: OpportunitySourceSchema is defined here (not in search-opportunity.ts)
 * to avoid a circular dependency — search-opportunity.ts imports from here.
 */

import { z } from 'zod';

// ─── Source enum ──────────────────────────────────────────────────────────────

export const OpportunitySourceSchema = z.enum(['SAM_GOV', 'DIBBS', 'MANUAL_UPLOAD']);
export type OpportunitySource = z.infer<typeof OpportunitySourceSchema>;

// ─── Stored opportunity item ──────────────────────────────────────────────────

export const OpportunityItemSchema = z.object({
  orgId:     z.string().optional(),
  projectId: z.string().optional(),
  oppId:     z.string().optional(),
  source:    OpportunitySourceSchema,
  id:        z.string().min(1),
  title:     z.string().min(1),
  type:      z.string().nullable(),
  postedDateIso:       z.string().datetime().nullable(),
  responseDeadlineIso: z.string().datetime().nullable(),
  noticeId:            z.string().nullable(),
  solicitationNumber:  z.string().nullable(),
  naicsCode:           z.string().nullable(),
  /** PSC / classification code — kept for pipeline filtering */
  pscCode:             z.string().nullable(),
  /** Issuing agency name */
  organizationName:    z.string().nullable(),
  /** Set-aside description */
  setAside:            z.string().nullable(),
  description:         z.string().nullable(),
  active:              z.boolean(),
  baseAndAllOptionsValue: z.number().nonnegative().nullable(),
  // Audit fields
  createdBy:     z.string().optional(),
  updatedBy:     z.string().optional(),
  createdByName: z.string().optional(),
  updatedByName: z.string().optional(),
});

export type OpportunityItem = z.infer<typeof OpportunityItemSchema>;

// ─── Query DTO ────────────────────────────────────────────────────────────────

export const OpportunityQuerySchema = z.object({
  orgId:     z.string().nullable(),
  projectId: z.string().min(1),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v > 0 && v <= 200), {
      message: 'limit must be a number between 1 and 200',
    })
    .optional(),
  nextToken: z.string().optional(),
});

export type OpportunityQuery = z.infer<typeof OpportunityQuerySchema>;
