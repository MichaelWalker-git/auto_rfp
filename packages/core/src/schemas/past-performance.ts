import { z } from 'zod';

/**
 * Past Performance Matching Feature
 * 
 * This module provides schemas for managing past projects and matching them
 * to RFP requirements for Bid/No-Bid decisions (Criterion 2: Past Performance Relevance).
 */

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

  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  isArchived: z.boolean().default(false),
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
  if (!endDate) return 50; // Default to middle score if no date

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
  if (!rating) return 50; // Default to middle score if no rating

  // Rating is 1-5, convert to 0-100
  return Math.round((rating / 5) * 100);
}