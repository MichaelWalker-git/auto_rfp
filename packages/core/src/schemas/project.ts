import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

// ─── Project Contact Info ─────────────────────────────────────────────────────

export const ProjectContactInfoSchema = z.object({
  primaryPocName: z.string().optional(),
  primaryPocEmail: z.string().email('Invalid email address').optional().or(z.literal('')),
  primaryPocPhone: z.string().optional(),
  primaryPocTitle: z.string().optional(),
});

export type ProjectContactInfo = z.infer<typeof ProjectContactInfoSchema>;

// ─── Project Schemas ──────────────────────────────────────────────────────────

/**
 * Incoming request body for creating a project.
 */
export const ProjectCreateRequestSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  contactInfo: ProjectContactInfoSchema.optional(),
});

export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;

/**
 * Incoming request body for updating a project (all mutable fields optional).
 */
export const ProjectUpdateRequestSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty').optional(),
  description: z.string().optional(),
  contactInfo: ProjectContactInfoSchema.optional(),
});

export type ProjectUpdateRequest = z.infer<typeof ProjectUpdateRequestSchema>;

/**
 * Project domain entity returned by the API.
 * Pure domain shape — does NOT include DynamoDB keys.
 */
export const ProjectItemSchema = ProjectCreateRequestSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
});

export type ProjectItem = z.infer<typeof ProjectItemSchema>;

/**
 * Project record as stored in DynamoDB — domain entity plus single-table keys.
 */
export const ProjectDBItemSchema = ProjectItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});

export type ProjectDBItem = z.infer<typeof ProjectDBItemSchema>;

/**
 * Lightweight project shape for list views, grids and selectors.
 */
export const ProjectListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  orgId: z.string(),
  description: z.string().optional(),
  createdAt: z.string().optional(),
});

export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;
