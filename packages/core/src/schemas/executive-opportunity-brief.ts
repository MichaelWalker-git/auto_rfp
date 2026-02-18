import { z } from 'zod';
import { PastPerformanceSectionSchema } from './past-performance';

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
 * Evidence pointers (helps reduce hallucination and allows traceability)
 */
export const EvidenceRefSchema = z.object({
  source: z.string().optional().nullable(),
  snippet: z.string().min(1).optional().nullable(),
  chunkKey: z.string().min(1).optional().nullable(),
  documentId: z.string().min(1).optional().nullable(),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/**
 * ================
 * SECTION: Summary
 * ================
 */
export const QuickSummarySchema = z.object({
  title: z.string().optional().nullable(),
  agency: z.string().optional().nullable(),
  office: z.string().optional().nullable(),
  solicitationNumber: z.string().optional().nullable(),

  naics: z
    .string()
    .optional()
    .nullable(),

  contractType: z.string().default('UNKNOWN'),

  setAside: z.string().default('UNKNOWN'),

  placeOfPerformance: z.string().optional().nullable(),

  estimatedValueUsd: z.number().nonnegative().optional().nullable(),
  periodOfPerformance: z.string().optional().nullable(),

  summary: z.string().min(10),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export type QuickSummary = z.infer<typeof QuickSummarySchema>;

/**
 * ==================
 * SECTION: Deadlines
 * ==================
 */
export const DeadlineSchema = z.object({
  type: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
  dateTimeIso: z.string().datetime({ offset: true }).optional().nullable(),
  rawText: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export type Deadline = z.infer<typeof DeadlineSchema>;

export const DeadlinesSectionSchema = z.object({
  deadlines: z.array(DeadlineSchema).min(1),
  hasSubmissionDeadline: z.boolean().default(false),
  submissionDeadlineIso: z.string().datetime({ offset: true }).nullable().optional(),
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
  evidence: z.array(EvidenceRefSchema).default([]),
});

export const RequirementsSectionSchema = z.object({
  overview: z.string().min(10),
  requirements: z.array(RequirementItemSchema).min(1),
  deliverables: z.array(z.string().min(1)).default([]),
  evaluationFactors: z.array(z.string().min(1)).default([]),
  submissionCompliance: z.object({
    format: z.array(z.string().min(1)).default([]), // page limits, font size, file naming, etc.
    requiredVolumes: z.array(z.string().min(1)).default([]), // technical/management/price
    attachmentsAndForms: z.array(z.string().min(1)).default([]),
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
  name: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  organization: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export const ContactsSectionSchema = z.object({
  contacts: z.array(ContactSchema).optional().nullable(),
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
  evidence: z.array(EvidenceRefSchema).default([]),
});

export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const RisksSectionSchema = z.object({
  risks: z.array(RiskFlagSchema).default([]),
  redFlags: z.array(RiskFlagSchema).default([]), // keep “red flags” separate if you want
  incumbentInfo: z.object({
    knownIncumbent: z.boolean().default(false),
    incumbentName: z.string().optional().nullable(),
    recompete: z.boolean().default(false),
    notes: z.string().optional().nullable(),
    evidence: z.array(EvidenceRefSchema).default([]),
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
    evidence: z.array(EvidenceRefSchema).optional(),
  })
  .partial();

export const ScoringSectionSchema = z
  .object({
    criteria: z.array(ScoreCriterionSchema).optional(),
    compositeScore: z.number().optional(),
    recommendation: RecommendationSchema.optional(),
    confidence: z.number().int().min(0).max(100).optional(),
    summaryJustification: z.string().min(20).optional(),
    decision: DecisionSchema.optional().nullable(),
    decisionRationale: z.string().min(20).optional().nullable(),
    blockers: z.array(z.string().min(3)).optional(),
    requiredActions: z.array(z.string().min(3)).optional(),
    confidenceExplanation: z.string().min(20).optional().nullable(),
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
    status: SectionStatusSchema.optional().nullable(),
    updatedAt: z.string().datetime().optional().nullable(),
    error: z.string().min(1).optional().nullable(),
    data: dataSchema.optional().nullable(),
  }).passthrough();

/**
 * ==========================
 * Executive Brief Dynamo Item
 * ==========================
 */
export const ExecutiveBriefItemSchema = z.object({
  projectId: z.string().min(1),
  orgId: z.string().min(1).optional().nullable(), // Organization ID for reference
  opportunityId: z.string().min(1), // Required - brief is always for a specific opportunity
  allTextKeys: z.array(z.string()).optional().nullable(), // All text keys for multi-document analysis
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
  compositeScore: z.number().optional().nullable(),
  recommendation: RecommendationSchema.optional().nullable(),
  decision: DecisionSchema.optional().nullable(),
  confidence: z.number().int().min(0).max(100).optional().nullable(),

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
  topK: z.number().int().min(1).max(100).optional().nullable(),
  force: z.boolean().optional().nullable(),
}).passthrough();

export type GenerateSectionRequest = z.infer<typeof GenerateSectionRequestSchema>;
