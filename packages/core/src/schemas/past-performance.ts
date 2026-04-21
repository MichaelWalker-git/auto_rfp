import { z } from 'zod';
import { FreshnessStatusSchema, StaleReasonSchema } from './content-library';

/**
 * Past Performance Matching Feature
 *
 * This module provides schemas for managing past projects and matching them
 * to RFP requirements for Bid/No-Bid decisions (Criterion 2: Past Performance Relevance).
 */

// ================================
// Extraction Source (needed before PastProjectSchema)
// ================================

export const ExtractionSourceSchema = z.object({
  sourceType: z.enum(['DIRECT_UPLOAD', 'KB_EXTRACTION']),
  sourceDocumentKey: z.string().optional(),
  sourceDocumentName: z.string().optional(),
  sourceKbId: z.string().uuid().optional(),
  sourceDocumentId: z.string().uuid().optional(),
  sourceChunkKeys: z.array(z.string()).optional().default([]),
  extractionJobId: z.string().uuid().optional(),
  extractedAt: z.string().datetime(),
  extractedBy: z.string().uuid(),
});

export type ExtractionSource = z.infer<typeof ExtractionSourceSchema>;

// ================================
// Contact Information
// ================================

export const PastProjectContactInfoSchema = z.object({
  name: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  organization: z.string().optional().nullable(),
});

export type PastProjectContactInfo = z.infer<typeof PastProjectContactInfoSchema>;

// ================================
// Past Project Entity
// ================================

export const PastProjectSchema = z.object({
  projectId: z.string().uuid(),
  orgId: z.string().uuid(),
  title: z.string().min(1),
  client: z.string().min(1),
  clientPOC: PastProjectContactInfoSchema.optional().nullable(),
  contractNumber: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  value: z.number().nonnegative().optional().nullable(),
  description: z.string().min(10),
  technicalApproach: z.string().optional().nullable(),
  achievements: z.array(z.string()).default([]),
  performanceRating: z.number().min(1).max(5).optional().nullable(),

  // Categorization
  domain: z.string().optional().nullable(), // e.g., "Healthcare", "Defense", "Finance"
  technologies: z.array(z.string()).default([]),
  naicsCodes: z.array(z.string()).default([]),
  contractType: z.string().optional().nullable(),
  setAside: z.string().optional().nullable(),

  // Scale metrics
  teamSize: z.number().int().positive().optional().nullable(),
  durationMonths: z.number().int().positive().optional().nullable(),

  // Usage tracking
  usageCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.string().datetime().nullable().optional(),
  usedInBriefIds: z.array(z.string()).max(100).default([]),

  // Freshness / stale content detection fields
  freshnessStatus: FreshnessStatusSchema.default('ACTIVE'),
  staleSince: z.string().datetime().nullable().optional(),
  staleReason: StaleReasonSchema.nullable().optional(),
  lastFreshnessCheck: z.string().datetime().nullable().optional(),
  reactivatedAt: z.string().datetime().nullable().optional(),
  reactivatedBy: z.string().uuid().nullable().optional(),

  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  isArchived: z.boolean().default(false),

  // Extraction source (preserved when created from AI extraction)
  extractionSource: ExtractionSourceSchema.optional().nullable(),
});

export type PastProject = z.infer<typeof PastProjectSchema>;

// ================================
// Match Details
// ================================

export const MatchDetailsSchema = z.object({
  technicalSimilarity: z.number().min(0).max(100),
  domainSimilarity: z.number().min(0).max(100),
  scaleSimilarity: z.number().min(0).max(100),
  recency: z.number().min(0).max(100),
  successMetrics: z.number().min(0).max(100),
});

export type MatchDetails = z.infer<typeof MatchDetailsSchema>;

// ================================
// Past Project Match Result
// ================================

export const PastProjectMatchSchema = z.object({
  project: PastProjectSchema,
  relevanceScore: z.number().min(0).max(100),
  matchDetails: MatchDetailsSchema,
  matchedRequirements: z.array(z.string()).default([]),
  narrative: z.string().optional().nullable(),
});

export type PastProjectMatch = z.infer<typeof PastProjectMatchSchema>;

// ================================
// Gap Analysis
// ================================

export const RequirementCoverageStatusSchema = z.enum(['COVERED', 'PARTIAL', 'GAP']);
export type RequirementCoverageStatus = z.infer<typeof RequirementCoverageStatusSchema>;

export const RequirementCoverageSchema = z.object({
  requirement: z.string(),
  category: z.string().optional().nullable(),
  status: RequirementCoverageStatusSchema,
  matchedProjectId: z.string().uuid().optional().nullable(),
  matchedProjectTitle: z.string().optional().nullable(),
  matchScore: z.number().min(0).max(100).optional().nullable(),
  recommendation: z.string().optional().nullable(),
});

export type RequirementCoverage = z.infer<typeof RequirementCoverageSchema>;

export const GapAnalysisSchema = z.object({
  coverageItems: z.array(RequirementCoverageSchema),
  overallCoverage: z.number().min(0).max(100),
  criticalGaps: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;

// ================================
// Past Performance Section (for Executive Brief)
// ================================

export const PastPerformanceEvidenceSchema = z.object({
  source: z.string().optional().nullable(),
  snippet: z.string().optional().nullable(),
  chunkKey: z.string().optional().nullable(),
  documentId: z.string().optional().nullable(),
});

export type PastPerformanceEvidence = z.infer<typeof PastPerformanceEvidenceSchema>;

export const PastPerformanceSectionSchema = z.object({
  topMatches: z.array(PastProjectMatchSchema).max(5).default([]),
  gapAnalysis: GapAnalysisSchema.optional().nullable(),
  narrativeSummary: z.string().optional().nullable(),
  confidenceScore: z.number().min(0).max(100).optional().nullable(),
  evidence: z.array(PastPerformanceEvidenceSchema).default([]),
});

export type PastPerformanceSection = z.infer<typeof PastPerformanceSectionSchema>;

// ================================
// DynamoDB Keys
// ================================

export const PAST_PROJECT_PK = 'PAST_PROJECT';

export function createPastProjectSK(orgId: string, projectId: string): string {
  return `${orgId}#${projectId}`;
}

export function parsePastProjectSK(sk: string): { orgId: string; projectId: string } | null {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { orgId: parts[0], projectId: parts[1] };
}

// ================================
// Request/Response DTOs
// ================================

export const CreatePastProjectDTOSchema = z.object({
  orgId: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  client: z.string().min(1, 'Client is required'),
  clientPOC: PastProjectContactInfoSchema.optional(),
  contractNumber: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  value: z.number().nonnegative().optional(),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  technicalApproach: z.string().optional(),
  achievements: z.array(z.string()).optional(),
  performanceRating: z.number().min(1).max(5).optional(),
  domain: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  naicsCodes: z.array(z.string()).optional(),
  contractType: z.string().optional(),
  setAside: z.string().optional(),
  teamSize: z.number().int().positive().optional(),
  durationMonths: z.number().int().positive().optional(),
  // Optional extraction source for items created from document extraction
  extractionSource: ExtractionSourceSchema.optional(),
});

export type CreatePastProjectDTO = z.infer<typeof CreatePastProjectDTOSchema>;

export const UpdatePastProjectDTOSchema = z.object({
  title: z.string().min(1).optional(),
  client: z.string().min(1).optional(),
  clientPOC: PastProjectContactInfoSchema.optional(),
  contractNumber: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  value: z.number().nonnegative().optional().nullable(),
  description: z.string().min(10).optional(),
  technicalApproach: z.string().optional().nullable(),
  achievements: z.array(z.string()).optional(),
  performanceRating: z.number().min(1).max(5).optional().nullable(),
  domain: z.string().optional().nullable(),
  technologies: z.array(z.string()).optional(),
  naicsCodes: z.array(z.string()).optional(),
  contractType: z.string().optional().nullable(),
  setAside: z.string().optional().nullable(),
  teamSize: z.number().int().positive().optional().nullable(),
  durationMonths: z.number().int().positive().optional().nullable(),
  isArchived: z.boolean().optional(),
});

export type UpdatePastProjectDTO = z.infer<typeof UpdatePastProjectDTOSchema>;

export const GetPastProjectRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export type GetPastProjectRequest = z.infer<typeof GetPastProjectRequestSchema>;

export const ListPastProjectsRequestSchema = z.object({
  orgId: z.string().uuid(),
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
});

export type ListPastProjectsRequest = z.infer<typeof ListPastProjectsRequestSchema>;

export const ListPastProjectsResponseSchema = z.object({
  items: z.array(PastProjectSchema),
  nextToken: z.string().optional().nullable(),
  total: z.number().int().nonnegative(),
});

export type ListPastProjectsResponse = z.infer<typeof ListPastProjectsResponseSchema>;

export const DeletePastProjectRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  hardDelete: z.boolean().optional().default(false),
});

export type DeletePastProjectRequest = z.infer<typeof DeletePastProjectRequestSchema>;

// ================================
// Matching & Analysis Requests
// ================================

export const MatchProjectsRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  topK: z.number().int().min(1).max(10).optional().default(5),
  force: z.boolean().optional().default(false),
});

export type MatchProjectsRequest = z.infer<typeof MatchProjectsRequestSchema>;

export const GenerateNarrativeRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  projectId: z.string().uuid().optional(),
  force: z.boolean().optional().default(false),
});

export type GenerateNarrativeRequest = z.infer<typeof GenerateNarrativeRequestSchema>;

export const GapAnalysisRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  force: z.boolean().optional().default(false),
});

export type GapAnalysisRequest = z.infer<typeof GapAnalysisRequestSchema>;

// ================================
// Relevance Score Weights
// ================================

export const RELEVANCE_WEIGHTS = {
  technicalSimilarity: 0.40,
  domainSimilarity: 0.25,
  scaleSimilarity: 0.20,
  recency: 0.10,
  successMetrics: 0.05,
} as const;

/**
 * Calculate the weighted relevance score from match details
 */
export function calculateRelevanceScore(details: MatchDetails): number {
  return Math.round(
    details.technicalSimilarity * RELEVANCE_WEIGHTS.technicalSimilarity +
    details.domainSimilarity * RELEVANCE_WEIGHTS.domainSimilarity +
    details.scaleSimilarity * RELEVANCE_WEIGHTS.scaleSimilarity +
    details.recency * RELEVANCE_WEIGHTS.recency +
    details.successMetrics * RELEVANCE_WEIGHTS.successMetrics
  );
}

/**
 * Calculate recency score based on project end date
 * More recent projects get higher scores
 */
export function calculateRecencyScore(endDate: string | null | undefined): number {
  if (!endDate) return 0;

  const end = new Date(endDate);
  const now = new Date();
  const yearsAgo = (now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24 * 365);

  if (yearsAgo <= 1) return 100;
  if (yearsAgo <= 2) return 90;
  if (yearsAgo <= 3) return 75;
  if (yearsAgo <= 5) return 50;
  if (yearsAgo <= 7) return 25;
  return 10;
}

/**
 * Calculate success metrics score based on performance rating
 */
export function calculateSuccessMetricsScore(rating: number | null | undefined): number {
  if (!rating) return 0;

  // Rating is 1-5, convert to 0-100
  return Math.round((rating / 5) * 100);
}

// ================================
// Draft Entity Schemas (for AI Extraction)
// ================================

export const DraftStatusSchema = z.enum([
  'DRAFT',           // Awaiting user review
  'CONFIRMED',       // User confirmed, now active
  'DISCARDED',       // User discarded the draft
  'EXPIRED',         // Auto-expired after 30 days
]);

export type DraftStatus = z.infer<typeof DraftStatusSchema>;

export const PastProjectFieldConfidenceSchema = z.object({
  title: z.number().min(0).max(100).optional(),
  client: z.number().min(0).max(100).optional(),
  contractNumber: z.number().min(0).max(100).optional(),
  value: z.number().min(0).max(100).optional(),
  description: z.number().min(0).max(100).optional(),
  achievements: z.number().min(0).max(100).optional(),
  domain: z.number().min(0).max(100).optional(),
  technologies: z.number().min(0).max(100).optional(),
  overall: z.number().min(0).max(100),
});

export type PastProjectFieldConfidence = z.infer<typeof PastProjectFieldConfidenceSchema>;

export const DuplicateWarningSchema = z.object({
  isDuplicate: z.boolean(),
  matchType: z.enum(['EXACT', 'SIMILAR', 'NONE']).default('NONE'),
  existingProjectId: z.string().uuid().optional(),
  existingProjectTitle: z.string().optional(),
  similarity: z.number().min(0).max(100).optional(),
  matchedFields: z.array(z.string()).default([]),
});

export type DuplicateWarning = z.infer<typeof DuplicateWarningSchema>;

export const PastProjectDraftSchema = PastProjectSchema.extend({
  draftStatus: DraftStatusSchema.default('DRAFT'),
  extractionSource: ExtractionSourceSchema.optional(),
  fieldConfidence: PastProjectFieldConfidenceSchema.optional(),
  duplicateWarning: DuplicateWarningSchema.optional(),
  expiresAt: z.string().datetime().optional(),
});

export type PastProjectDraft = z.infer<typeof PastProjectDraftSchema>;

// DynamoDB Keys for Drafts
export const DRAFT_PAST_PROJECT_PK = 'DRAFT_PAST_PROJECT';

export const createDraftPastProjectSK = (orgId: string, projectId: string): string =>
  `${orgId}#${projectId}`;

// ================================
// Draft Management DTOs
// ================================

export const ConfirmDraftRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  overrides: UpdatePastProjectDTOSchema.optional(),
});

export type ConfirmDraftRequest = z.infer<typeof ConfirmDraftRequestSchema>;

export const DiscardDraftRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export type DiscardDraftRequest = z.infer<typeof DiscardDraftRequestSchema>;

export const ListDraftsRequestSchema = z.object({
  orgId: z.string().uuid(),
  status: DraftStatusSchema.optional(),
  targetType: z.enum(['PAST_PERFORMANCE', 'LABOR_RATE']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  nextToken: z.string().optional(),
});

export type ListDraftsRequest = z.infer<typeof ListDraftsRequestSchema>;

export interface PastProjectDraftsResponse {
  drafts: PastProjectDraft[];
  total: number;
  nextToken?: string;
}
