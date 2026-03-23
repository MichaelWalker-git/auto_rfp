import { z } from 'zod';
import { PastPerformanceSectionSchema } from './past-performance';
import { PricingSectionSchema } from './pricing';
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
  'CONTRACTING_OFFICER_REPRESENTATIVE',
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
  title: z.string().nullish(),
  agency: z.string().nullish(),
  office: z.string().nullish(),
  solicitationNumber: z.string().nullish(),
  naics: z.string().nullish(),
  contractType: z.string().nullish().default('UNKNOWN'),
  setAside: z.string().nullish().default('UNKNOWN'),
  placeOfPerformance: z.string().nullish(),
  estimatedValueUsd: z.string().nullish(),
  periodOfPerformance: z.string().nullish(),
  summary: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v.trim();
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v || '');
    },
    z.string().min(1, 'Summary must not be empty'),
  ),
}).passthrough(); // Allow extra fields from LLM without failing validation

export type QuickSummary = z.infer<typeof QuickSummarySchema>;

/**
 * ==================
 * SECTION: Deadlines
 * ==================
 */
export const DeadlineSchema = z.object({
  type: z.string().nullish(),
  label: z.string().nullish(),
  dateTimeIso: z.string().datetime({ offset: true }).nullish(),
  rawText: z.string().nullish(),
  timezone: z.string().nullish(),
  notes: z.string().nullish(),
});

export type Deadline = z.infer<typeof DeadlineSchema>;

export const DeadlinesSectionSchema = z.object({
  deadlines: z.array(DeadlineSchema).min(1),
  hasSubmissionDeadline: z.boolean().nullish().default(false),
  submissionDeadlineIso: z.string().datetime({ offset: true }).nullish().transform(v => v ?? undefined),
  warnings: z.array(z.string()).nullish().default([]),
});

export type DeadlinesSection = z.infer<typeof DeadlinesSectionSchema>;

/**
 * =====================
 * SECTION: Requirements
 * =====================
 */
export const RequirementItemSchema = z.object({
  category: z.string().nullish(),
  requirement: z.string().nullish().default(''),
  mustHave: z.boolean().nullish().default(true),
});

/**
 * A required output (response) document extracted from the solicitation's
 * Section L / submission instructions.
 * Uses passthrough + coercion so unknown documentType values don't drop the item.
 */
export const RequiredOutputDocumentSchema = z.object({
  documentType: z.union([RFPDocumentTypeSchema, z.string()]).nullish().transform(val => {
    if (!val) return 'OTHER' as const;
    const valid = RFPDocumentTypeSchema.safeParse(val);
    return valid.success ? valid.data : 'OTHER' as const;
  }),
  name: z.string().nullish().default(''),
  description: z.string().nullish(),
  pageLimit: z.string().nullish(),
  required: z.boolean().nullish().default(true),
});

export type RequiredOutputDocument = z.infer<typeof RequiredOutputDocumentSchema>;

export const RequirementsSectionSchema = z.object({
  overview: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    },
    z.string(),
  ),
  requirements: z.array(RequirementItemSchema).nullish().default([]),
  deliverables: z.array(z.string()).nullish().default([]),
  evaluationFactors: z.array(z.string()).nullish().default([]),
  submissionCompliance: z.object({
    format: z.array(z.string()).nullish().default([]),
    requiredVolumes: z.array(z.string()).nullish().default([]),
    attachmentsAndForms: z.array(z.string()).nullish().default([]),
    requiredDocuments: z.array(RequiredOutputDocumentSchema).nullish().default([]),
  }).nullish(),
});

export type RequirementsSection = z.infer<typeof RequirementsSectionSchema>;

/**
 * =================
 * SECTION: Contacts
 * =================
 */
export const ContactSchema = z.object({
  role: RoleSchema.nullish(),
  name: z.string().nullish(),
  title: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  organization: z.string().nullish(),
  notes: z.string().nullish(),
});

export const ContactsSectionSchema = z.object({
  contacts: z.array(ContactSchema).nullish(),
  missingRecommendedRoles: z.array(RoleSchema).nullish().default([]),
});

export type ContactsSection = z.infer<typeof ContactsSectionSchema>;

/**
 * ================
 * SECTION: Risks
 * ================
 */
export const RiskFlagSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).nullish(),
  flag: z.string().nullish().default(''),
  whyItMatters: z.string().nullish(),
  mitigation: z.string().nullish(),
  impactsScore: z.boolean().nullish().default(false),
});

export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const RisksSectionSchema = z.object({
  risks: z.array(RiskFlagSchema).nullish().default([]),
  redFlags: z.array(RiskFlagSchema).nullish().default([]),
  incumbentInfo: z.object({
    knownIncumbent: z.boolean().nullish().default(false),
    incumbentName: z.string().nullish(),
    recompete: z.boolean().nullish().default(false),
    notes: z.string().nullish(),
  }).nullish(),
});

export type RisksSection = z.infer<typeof RisksSectionSchema>;

/**
 * ===================
 * SECTION: Bid Scoring (ALL OPTIONAL)
 * ===================
 */
export const ScoreCriterionSchema = z
  .object({
    name: z.string().nullish(),
    score: z.number().int().min(1).max(5).nullish(),
    rationale: z.string().nullish(),
    gaps: z.array(z.string()).nullish(),
  })
  .partial();

export const ScoringSectionSchema = z
  .object({
    criteria: z.array(ScoreCriterionSchema).nullish(),
    compositeScore: z.number().nullish(),
    recommendation: RecommendationSchema.nullish(),
    confidence: z.number().int().min(0).max(100).nullish(),
    summaryJustification: z.string().nullish(),
    decision: DecisionSchema.nullish(),
    decisionRationale: z.string().nullish(),
    blockers: z.array(z.string()).nullish(),
    requiredActions: z.array(z.string()).nullish(),
    confidenceExplanation: z.string().nullish(),
    confidenceDrivers: z
      .array(
        z.object({
          factor: z.string().nullish(),
          direction: z.enum(['UP', 'DOWN']).nullish(),
        }),
      )
      .nullish(),
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
    status: SectionStatusSchema.nullish(),
    updatedAt: z.string().datetime().nullish(),
    error: z.string().nullish(),
    data: dataSchema.nullish(),
  }).passthrough();

/**
 * ==========================
 * Executive Brief Dynamo Item
 * ==========================
 */
export const ExecutiveBriefItemSchema = z.object({
  projectId: z.string().min(1),
  orgId: z.string().nullish(),
  opportunityId: z.string().min(1), // Required - brief is always for a specific opportunity
  allTextKeys: z.array(z.string()).nullish(),
  documentsBucket: z.string().min(1),
  status: SectionStatusSchema,
  sections: z.object({
    summary: SectionWrapperSchema(QuickSummarySchema),
    deadlines: SectionWrapperSchema(DeadlinesSectionSchema),
    requirements: SectionWrapperSchema(RequirementsSectionSchema),
    contacts: SectionWrapperSchema(ContactsSectionSchema),
    risks: SectionWrapperSchema(RisksSectionSchema),
    pricing: SectionWrapperSchema(PricingSectionSchema),
    pastPerformance: SectionWrapperSchema(PastPerformanceSectionSchema),
    scoring: SectionWrapperSchema(ScoringSectionSchema),
  }),
  compositeScore: z.number().nullish(),
  recommendation: RecommendationSchema.nullish(),
  decision: DecisionSchema.nullish(),
  confidence: z.number().int().min(0).max(100).nullish(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // linear specific
  linearTicketId: z.string().nullish(),
  linearTicketIdentifier: z.string().nullish(),
  linearTicketUrl: z.string().nullish(),
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
  topK: z.number().int().min(1).max(100).nullish(),
  force: z.boolean().nullish(),
}).passthrough();

export type GenerateSectionRequest = z.infer<typeof GenerateSectionRequestSchema>;
