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
  postedFrom: MmDdYyyySchema,
  postedTo: MmDdYyyySchema,

  keywords: z.string().min(1).optional(),
  title: z.string().min(1).optional(),

  naics: z.array(z.string().min(2)).optional(),
  psc: z.array(z.string().min(2)).optional(),

  organizationCode: z.string().optional(),
  organizationName: z.string().optional(),

  setAsideCode: z.string().optional(),
  ptype: z.array(z.string()).optional(),

  state: z.string().optional(),
  zip: z.string().optional(),

  dollarRange: DollarRangeSchema,

  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

export type LoadSamOpportunitiesRequest = z.infer<typeof LoadSamOpportunitiesRequestSchema>;

export const SamOpportunitySlimSchema = z.object({
  noticeId: z.string().optional(),
  solicitationNumber: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  postedDate: z.string().optional(),
  responseDeadLine: z.string().optional(),
  naicsCode: z.string().optional(),
  classificationCode: z.string().optional(),
  active: z.union([z.string(), z.boolean()]).optional(),
  setAside: z.string().optional(),
  setAsideCode: z.string().optional(),
  fullParentPathName: z.string().optional(),
  fullParentPathCode: z.string().optional(),
  description: z.string().optional(),

  baseAndAllOptionsValue: z.number().optional(),
  award: z.any().optional(),

  attachmentsCount: z.number().int().nonnegative().optional(),
});

export type SamOpportunitySlim = z.infer<typeof SamOpportunitySlimSchema>;

export const LoadSamOpportunitiesResponseSchema = z.object({
  totalRecords: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  opportunities: z.array(SamOpportunitySlimSchema),
});

export type LoadSamOpportunitiesResponse = z.infer<typeof LoadSamOpportunitiesResponseSchema>;

export const SavedSearchFrequencySchema = z.enum(['HOURLY', 'DAILY', 'WEEKLY']);
export type SavedSearchFrequency = z.infer<typeof SavedSearchFrequencySchema>;

export const SavedSearchSchema = z.object({
  savedSearchId: z.string().min(1),
  orgId: z.string().min(1),

  name: z.string().min(1).max(120),

  // store the exact criteria you send to SAM (strongly typed)
  criteria: LoadSamOpportunitiesRequestSchema,

  frequency: SavedSearchFrequencySchema.default('DAILY'),

  autoImport: z.boolean().default(false),
  notifyEmails: z.array(z.string().email()).default([]),

  isEnabled: z.boolean().default(true),

  lastRunAt: z.string().datetime().nullable().default(null),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const CreateSavedSearchRequestSchema = z.object({
  orgId: z.string().min(1),

  name: z.string().min(1).max(120),

  // same object as LoadSamOpportunitiesRequest, but for “saved searches”
  criteria: LoadSamOpportunitiesRequestSchema,

  frequency: SavedSearchFrequencySchema.optional(),
  autoImport: z.boolean().optional(),
  notifyEmails: z.array(z.string().email()).optional(),
  isEnabled: z.boolean().optional(),
});

export type CreateSavedSearchRequest = z.infer<typeof CreateSavedSearchRequestSchema>;

export const CreateSavedSearchResponseSchema = SavedSearchSchema;
export type CreateSavedSearchResponse = z.infer<typeof CreateSavedSearchResponseSchema>;

export const PatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    criteria: LoadSamOpportunitiesRequestSchema.optional(),
    frequency: SavedSearchFrequencySchema.optional(),
    autoImport: z.boolean().optional(),
    notifyEmails: z.array(z.string().email()).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Patch body is required' });

export type PatchType = z.infer<typeof PatchSchema>