import { z } from 'zod';
import { SamOpportunitySlimSchema } from './samgov';

/**
 * A normalized “Opportunity” shape for your UI / DB / internal use.
 * Keep it stable even if SAM response fields are missing or inconsistent.
 */
export const OpportunitySourceSchema = z.enum(['SAM_GOV', 'MANUAL_UPLOAD']);
export type OpportunitySource = z.infer<typeof OpportunitySourceSchema>;

export const OpportunityItemSchema = z.object({
  orgId: z.string().optional(),
  projectId: z.string().optional(),
  oppId: z.string().optional(),
  source: OpportunitySourceSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().nullable(),
  postedDateIso: z.string().datetime().nullable(),
  responseDeadlineIso: z.string().datetime().nullable(),
  noticeId: z.string().nullable(),
  solicitationNumber: z.string().nullable(),
  naicsCode: z.string().nullable(),
  pscCode: z.string().nullable(),
  organizationName: z.string().nullable(),
  organizationCode: z.string().nullable(),
  setAside: z.string().nullable(),
  setAsideCode: z.string().nullable(),
  description: z.string().nullable(),
  active: z.boolean(),
  baseAndAllOptionsValue: z.number().nonnegative().nullable(),
  raw: SamOpportunitySlimSchema.optional(),
});

export type OpportunityItem = z.infer<typeof OpportunityItemSchema>;

/**
 * Helpers to normalize SAM weirdness.
 */
const ActiveBoolSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', 't', 'yes', 'y', '1', 'active'].includes(s)) return true;
      if (['false', 'f', 'no', 'n', '0', 'inactive'].includes(s)) return false;
    }
    return false;
  });

const NullableIsoDatetimeSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().datetime().nullable());

/**
 * Convert SAM slim -> OpportunityItem
 */
export const SamSlimToOpportunityItemSchema = SamOpportunitySlimSchema.transform((o) => {
  const noticeId = o.noticeId ?? null;
  const solicitationNumber = o.solicitationNumber ?? null;

  const id = noticeId || solicitationNumber || ''; // validated below

  return {
    source: 'SAM_GOV' as const,

    id,
    title: o.title?.trim() || '',

    type: o.type ?? null,

    postedDateIso: o.postedDate ?? null,
    responseDeadlineIso: o.responseDeadLine ?? null,

    noticeId,
    solicitationNumber,

    naicsCode: o.naicsCode ?? null,
    pscCode: o.classificationCode ?? null,

    organizationName: o.fullParentPathName ?? null,
    organizationCode: o.fullParentPathCode ?? null,

    setAside: o.setAside ?? null,
    setAsideCode: o.setAsideCode ?? null,

    description: o.description ?? null,

    // normalize later via schema below
    active: o.active as any,

    baseAndAllOptionsValue: o.baseAndAllOptionsValue ?? null,

    raw: o,
  };
}).pipe(
  OpportunityItemSchema.extend({
    // override with normalized parsers
    active: ActiveBoolSchema,
    postedDateIso: NullableIsoDatetimeSchema,
    responseDeadlineIso: NullableIsoDatetimeSchema,
    id: z.string().min(1, 'Opportunity is missing noticeId/solicitationNumber'),
    title: z.string().min(1, 'Opportunity title is missing'),
  }),
);

export type OpportunityItemFromSam = z.infer<typeof SamSlimToOpportunityItemSchema>;

export const OpportunityQuerySchema = z.object({
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