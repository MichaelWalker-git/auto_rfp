import { z } from 'zod';
import { PastPerformanceSectionSchema } from './past-performance';
import { RFPDocumentTypeSchema } from './rfp-document';

/**
 * Common enums
 */
export const SectionStatusSchema = z.enum([
  'IDLE',
  'IN_PROGRESS',
  'COMPLETE',
  'FAILED',
]);

export type SectionStatus = z.infer<typeof SectionStatusSchema>;

export const RecommendationSchema = z.enum(['GO', 'NO_GO', 'NEEDS_REVIEW']);
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const DecisionSchema = z.enum(['GO', 'CONDITIONAL_GO', 'NO_GO']);
export type Decision = z.infer<typeof DecisionSchema>;

export const RoleSchema = z.enum([
  'CONTRACTING_OFFICER',
  'CONTRACT_SPECIALIST',
  'TECHNICAL_POC',
  'PROGRAM_MANAGER',
  'SMALL_BUSINESS_SPECIALIST',
  'PROCUREMENT_POC',
  'SUBCONTRACTING_POC',
  'GENERAL_INQUIRY',
  'OTHER',
]);

export type ContactRole = z.infer<typeof RoleSchema>;

/**
 * ================
 * SECTION: Summary
 * ================
 */
export const QuickSummarySchema = z.object({
  title: z.string().optional(),
  agency: z.string().optional(),
  office: z.string().optional(),
  solicitationNumber: z.string().optional(),
  naics: z.string().optional(),
  contractType: z.string().default('UNKNOWN'),
  setAside: z.string().default('UNKNOWN'),
  placeOfPerformance: z.string().optional(),
  estimatedValueUsd: z.string().optional(),
  periodOfPerformance: z.string().optional(),
  summary: z.string().min(10),
});

export type QuickSummary = z.infer<typeof QuickSummarySchema>;

/**
 * ==================
 * SECTION: Deadlines
 * ==================
 */
export const DeadlineSchema = z.object({
  type: z.string().optional(),
  label: z.string().optional(),
  dateTimeIso: z.string().datetime({ offset: true }).optional(),
  rawText: z.string().optional(),
  timezone: z.string().optional(),
  notes: z.string().optional(),
});

export type Deadline = z.infer<typeof DeadlineSchema>;

export const DeadlinesSectionSchema = z.object({
  deadlines: z.array(DeadlineSchema).min(1),
  hasSubmissionDeadline: z.boolean().default(false),
  // Accept null from model output and coerce to undefined
  submissionDeadlineIso: z.string().datetime({ offset: true }).nullish().transform(v => v ?? undefined),
  warnings: z.array(z.string().min(1)).default([]), // "No explicit timezone found", etc.
});

export type DeadlinesSection = z.infer<typeof DeadlinesSectionSchema>;

/**
 * =====================
 * SECTION: Requirements
 * =====================
 */
export const RequirementItemSchema = z.object({
  category: z.string().optional(),
  requirement: z.string().min(5),
  mustHave: z.boolean().default(true),
});

/**
 * A required output (response) document extracted from the solicitation's
 * Section L / submission instructions.
 * Uses passthrough + coercion so unknown documentType values don't drop the item.
 */
export const RequiredOutputDocumentSchema = z.object({
  documentType: z.union([RFPDocumentTypeSchema, z.string()]).transform(val => {
    const valid = RFPDocumentTypeSchema.safeParse(val);
    return valid.success ? valid.data : 'OTHER' as const;
  }),
  name: z.string().min(1),
  description: z.string().optional(),
  pageLimit: z.string().optional(),
  required: z.boolean().default(true),
});

export type RequiredOutputDocument = z.infer<typeof RequiredOutputDocumentSchema>;

export const RequirementsSectionSchema = z.object({
  overview: z.preprocess(
    (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v),
    z.string().min(10),
  ),
  requirements: z.array(RequirementItemSchema).min(1),
  deliverables: z.array(z.string().min(1)).default([]),
  evaluationFactors: z.array(z.string().min(1)).default([]),
  submissionCompliance: z.object({
    format: z.array(z.string().min(1)).default([]), // page limits, font size, file naming, etc.
    requiredVolumes: z.array(z.string().min(1)).default([]), // technical/management/price
    attachmentsAndForms: z.array(z.string().min(1)).default([]),
    /** Structured list of required output/response documents extracted from Section L */
    requiredDocuments: z.array(RequiredOutputDocumentSchema).default([]),
  }),
});

export type RequirementsSection = z.infer<typeof RequirementsSectionSchema>;

/**
 * =================
 * SECTION: Contacts
 * =================
 */
export const ContactSchema = z.object({
  role: RoleSchema,
  name: z.string().nullish(),
  title: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  organization: z.string().nullish(),
  notes: z.string().nullish(),
});

export const ContactsSectionSchema = z.object({
  contacts: z.array(ContactSchema).optional(),
  missingRecommendedRoles: z.array(RoleSchema).default([]),
});

export type ContactsSection = z.infer<typeof ContactsSectionSchema>;

/**
 * ================
 * SECTION: Risks
 * ================
 */
export const RiskFlagSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  flag: z.string().min(5),
  whyItMatters: z.string().min(5).optional(),
  mitigation: z.string().min(5).optional(),
  impactsScore: z.boolean().default(false),
});

export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const RisksSectionSchema = z.object({
  risks: z.array(RiskFlagSchema).default([]),
  redFlags: z.array(RiskFlagSchema).default([]),
  incumbentInfo: z.object({
    knownIncumbent: z.boolean().default(false),
    incumbentName: z.string().optional(),
    recompete: z.boolean().default(false),
    notes: z.string().optional(),
  }),
});

export type RisksSection = z.infer<typeof RisksSectionSchema>;

/**
 * ===================
 * SECTION: Bid Scoring (ALL OPTIONAL)
 * ===================
 */
export const ScoreCriterionSchema = z
  .object({
    name: z.string().optional(),
    score: z.number().int().min(1).max(5).optional(),
    rationale: z.string().min(10).optional(),
    gaps: z.array(z.string().min(1)).optional(),
  })
  .partial();

export const ScoringSectionSchema = z
  .object({
    criteria: z.array(ScoreCriterionSchema).optional(),
    compositeScore: z.number().optional(),
    recommendation: RecommendationSchema.optional(),
    confidence: z.number().int().min(0).max(100).optional(),
    summaryJustification: z.string().min(20).optional(),
    decision: DecisionSchema.optional(),
    decisionRationale: z.string().min(20).optional(),
    blockers: z.array(z.string().min(3)).optional(),
    requiredActions: z.array(z.string().min(3)).optional(),
    confidenceExplanation: z.string().min(20).optional(),
    confidenceDrivers: z
      .array(
        z.object({
          factor: z.string().min(3).optional(),
          direction: z.enum(['UP', 'DOWN']).optional(),
        }),
      )
      .optional(),
  })
  .partial();

export type ScoringSection = z.infer<typeof ScoringSectionSchema>;

/**
 * ==========================
 * Section wrapper (status + data)
 * ==========================
 */
export const SectionWrapperSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    status: SectionStatusSchema.optional(),
    updatedAt: z.string().datetime().optional(),
    error: z.string().min(1).optional(),
    data: dataSchema.optional().nullable(),
  }).passthrough();

/**
 * ==========================
 * Executive Brief Dynamo Item
 * ==========================
 */
export const ExecutiveBriefItemSchema = z.object({
  projectId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  opportunityId: z.string().min(1), // Required - brief is always for a specific opportunity
  allTextKeys: z.array(z.string()).optional(),
  documentsBucket: z.string().min(1),
  status: SectionStatusSchema,
  sections: z.object({
    summary: SectionWrapperSchema(QuickSummarySchema),
    deadlines: SectionWrapperSchema(DeadlinesSectionSchema),
    requirements: SectionWrapperSchema(RequirementsSectionSchema),
    contacts: SectionWrapperSchema(ContactsSectionSchema),
    risks: SectionWrapperSchema(RisksSectionSchema),
    pastPerformance: SectionWrapperSchema(PastPerformanceSectionSchema),
    scoring: SectionWrapperSchema(ScoringSectionSchema),
  }),
  compositeScore: z.number().optional(),
  recommendation: RecommendationSchema.optional(),
  decision: DecisionSchema.optional(),
  confidence: z.number().int().min(0).max(100).optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // linear specific
  linearTicketId: z.string().optional(),
  linearTicketIdentifier: z.string().optional(),
  linearTicketUrl: z.string().optional(),
}).passthrough();

export type ExecutiveBriefItem = z.infer<typeof ExecutiveBriefItemSchema>;

/**
 * ==========================
 * Requests (for lambdas)
 * ==========================
 */
export const InitExecutiveBriefRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1), // Required - brief is always for a specific opportunity
});

export type InitExecutiveBriefRequest = z.infer<
  typeof InitExecutiveBriefRequestSchema
>;

export const GenerateSectionRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  topK: z.number().int().min(1).max(100).optional(),
  force: z.boolean().optional(),
}).passthrough();

export type GenerateSectionRequest = z.infer<typeof GenerateSectionRequestSchema>;
