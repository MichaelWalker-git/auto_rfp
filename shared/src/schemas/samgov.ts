import { z } from 'zod';

export const MmDdYyyySchema = z
  .string()
  .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy');

export const DollarRangeSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .optional();

export const LoadSamOpportunitiesRequestSchema = z.object({
  // required by SAM endpoint
  postedFrom: MmDdYyyySchema,
  postedTo: MmDdYyyySchema,

  // keywords / free text
  keywords: z.string().min(1).optional(),  // mapped to "title" (basic) or "keyword" if you later switch endpoints
  title: z.string().min(1).optional(),

  // codes
  naics: z.array(z.string().min(2)).optional(),      // maps to ncode (repeat param)
  psc: z.array(z.string().min(2)).optional(),        // maps to ccode (repeat param)

  // agency
  organizationCode: z.string().optional(),
  organizationName: z.string().optional(),

  // set-aside
  setAsideCode: z.string().optional(),               // SAM often uses setAsideCode

  // notice type / procurement type
  ptype: z.array(z.string()).optional(),             // passed through as multi param

  // location filters (optional)
  state: z.string().optional(),
  zip: z.string().optional(),

  // dollar range (not always supported directly; we filter client-side if present)
  dollarRange: DollarRangeSchema,

  // paging
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

export type LoadSamOpportunitiesRequest = z.infer<typeof LoadSamOpportunitiesRequestSchema>;

// Keep your existing response schemas/types
export const SamOpportunitySlimSchema = z.object({
  noticeId: z.string().optional(),
  solicitationNumber: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  postedDate: z.string().optional(),
  responseDeadLine: z.string().optional(),
  naicsCode: z.string().optional(),
  classificationCode: z.string().optional(),
  active: z.string().optional(),
  setAside: z.string().optional(),
  setAsideCode: z.string().optional(),
  fullParentPathName: z.string().optional(),
  fullParentPathCode: z.string().optional(),
  description: z.string().optional(),

  // optional fields if SAM returns them
  baseAndAllOptionsValue: z.number().optional(),
  award: z.any().optional(),
});

export type SamOpportunitySlim = z.infer<typeof SamOpportunitySlimSchema>;

export const LoadSamOpportunitiesResponseSchema = z.object({
  totalRecords: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  opportunities: z.array(SamOpportunitySlimSchema),
});

export type LoadSamOpportunitiesResponse = z.infer<typeof LoadSamOpportunitiesResponseSchema>;
