import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

/**
 * Incoming request body for creating an organization.
 */
export const OrganizationCreateRequestSchema = z.object({
  name: z.string()
    .trim()
    .min(3, 'Name must be at least 3 characters long'),

  description: z.string()
    .trim()
    .max(500, 'Description cannot exceed 500 characters')
    .optional(),

  bucketName: z.string()
    .optional(),

  iconKey: z.string()
    .optional(),

  // Clustering thresholds (0-1 range) - no defaults here, handle at application level
  clusterThreshold: z.number()
    .min(0.5, 'Cluster threshold must be at least 50%')
    .max(1.0, 'Cluster threshold cannot exceed 100%')
    .optional(),

  similarThreshold: z.number()
    .min(0.3, 'Similar threshold must be at least 30%')
    .max(1.0, 'Similar threshold cannot exceed 100%')
    .optional(),
});

export type OrganizationCreateRequest = z.infer<typeof OrganizationCreateRequestSchema>;

/**
 * Incoming request body for updating an organization (all fields optional).
 */
export const OrganizationUpdateRequestSchema = OrganizationCreateRequestSchema.partial();

export type OrganizationUpdateRequest = z.infer<typeof OrganizationUpdateRequestSchema>;

/**
 * Organization domain entity returned by the API.
 * Pure domain shape — does NOT include DynamoDB keys.
 */
export const OrganizationItemSchema = OrganizationCreateRequestSchema.extend({
  id: z.string(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  /** Optional aggregated counts returned by the API */
  _count: z.object({
    projects:          z.number().int().nonnegative(),
    organizationUsers: z.number().int().nonnegative(),
  }).optional(),
  /** Shallow list of org members (optional, returned by some endpoints) */
  organizationUsers: z.array(z.object({
    id:   z.string(),
    role: z.string(),
    user: z.object({
      id:    z.string(),
      email: z.string(),
      name:  z.string().optional(),
    }),
  })).optional(),
  /** Shallow list of projects (optional) */
  projects: z.array(z.object({
    id:          z.string(),
    name:        z.string(),
    description: z.string().optional(),
    createdAt:   z.string(),
  })).optional(),
  /** Whether AI processing is enabled for this org */
  aiProcessingEnabled: z.boolean().optional(),
  /** Auto-approval threshold for content library (0–1) */
  autoApprovalThreshold: z.number().min(0).max(1).optional(),
  /** Org slug (short identifier) */
  slug: z.string().optional(),
  /** Whether POC generation via EventBridge is enabled for this org */
  enablePOCGeneration: z.boolean().optional(),
  /** Whether the AI full-package compliance review is enabled for this org (set manually in DynamoDB; no UI) */
  enableComplianceReview: z.boolean().optional(),
  /** Whether new-member detection alerts are enabled for this org (set manually in DynamoDB; no UI) */
  enableMemberDetection: z.boolean().optional().default(false),
  /** Whether the Solution Plan (Source of Truth) feature + generation gate is enabled for this org (set manually in DynamoDB; no UI) */
  enableSolutionPlan: z.boolean().optional(),
  /** Whether the KB coverage precheck *blocks* generation for this org (set manually in DynamoDB; no UI). Off = warn only. */
  enableKBCoverageGate: z.boolean().optional(),
});

export type OrganizationItem = z.infer<typeof OrganizationItemSchema>;

/**
 * Organization record as stored in DynamoDB — domain entity plus single-table keys.
 */
export const OrganizationDBItemSchema = OrganizationItemSchema.extend({
  [PK_NAME]: z.string(), // Partition Key (ORG_PK)
  [SK_NAME]: z.string(), // Sort Key (e.g., ORG#<UUID>)
});

export type OrganizationDBItem = z.infer<typeof OrganizationDBItemSchema>;

/**
 * Lightweight organization shape for list views, switchers and selectors.
 */
export const OrganizationListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  iconKey: z.string().optional(),
  enablePOCGeneration: z.boolean().optional(),
  enableComplianceReview: z.boolean().optional(),
  enableSolutionPlan: z.boolean().optional(),
  enableKBCoverageGate: z.boolean().optional(),
});

export type OrganizationListItem = z.infer<typeof OrganizationListItemSchema>;
