import { z } from 'zod';

// ─── RFP Document Version ─────────────────────────────────────────────────────

/**
 * A snapshot of an RFP document at a specific version.
 * Metadata stored in DynamoDB; actual HTML content stored in S3.
 */
export const RFPDocumentVersionSchema = z.object({
  versionId: z.string().uuid(),              // Unique ID for this version record
  documentId: z.string().uuid(),             // Parent RFP document ID
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  orgId: z.string().uuid(),
  versionNumber: z.number().int().min(1),    // Sequential version number (1, 2, 3...)
  
  // S3 reference
  htmlContentKey: z.string(),                // S3 key for HTML content
  s3VersionId: z.string().optional(),        // S3 version ID (if using S3 versioning)
  
  // Snapshot metadata
  title: z.string().nullable().optional(),
  documentType: z.string(),                  // e.g., 'TECHNICAL_PROPOSAL'
  wordCount: z.number().int().optional(),    // For quick stats display
  
  // Change tracking
  changeNote: z.string().max(500).optional(), // User-provided description of changes
  createdBy: z.string().uuid(),
  createdByName: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type RFPDocumentVersion = z.infer<typeof RFPDocumentVersionSchema>;

// ─── Create Version DTO ───────────────────────────────────────────────────────

export const CreateVersionDTOSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  changeNote: z.string().max(500).optional(),
});

export type CreateVersionDTO = z.infer<typeof CreateVersionDTOSchema>;

// ─── Version List Response ────────────────────────────────────────────────────

export const VersionListResponseSchema = z.object({
  items: z.array(RFPDocumentVersionSchema),
  count: z.number(),
});

export type VersionListResponse = z.infer<typeof VersionListResponseSchema>;

// ─── Version Comparison Request ───────────────────────────────────────────────

export const CompareVersionsRequestSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  fromVersion: z.number().int().min(1),      // Older version
  toVersion: z.number().int().min(1),        // Newer version
});

export type CompareVersionsRequest = z.infer<typeof CompareVersionsRequestSchema>;

// ─── Version Comparison Response ──────────────────────────────────────────────

export const VersionComparisonResponseSchema = z.object({
  fromVersion: RFPDocumentVersionSchema,
  toVersion: RFPDocumentVersionSchema,
  fromHtml: z.string(),                      // Raw HTML of older version
  toHtml: z.string(),                        // Raw HTML of newer version
  // Diff computed client-side for performance
});

export type VersionComparisonResponse = z.infer<typeof VersionComparisonResponseSchema>;

// ─── Revert Version DTO ───────────────────────────────────────────────────────

export const RevertVersionDTOSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  targetVersion: z.number().int().min(1),    // Version to revert to
  changeNote: z.string().max(500).optional(),
});

export type RevertVersionDTO = z.infer<typeof RevertVersionDTOSchema>;

// ─── Cherry-Pick Changes DTO ──────────────────────────────────────────────────

/**
 * Cherry-pick allows applying selected changes from one version to the current.
 * The changes array contains indices of diff hunks to apply.
 * This is computed client-side using the diff algorithm.
 */
export const CherryPickDTOSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  sourceVersion: z.number().int().min(1),    // Version to cherry-pick from
  /** 
   * Array of change indices to apply. 
   * These correspond to the diff hunks computed client-side.
   * The server receives the final merged HTML directly.
   */
  mergedHtml: z.string(),                    // Final HTML after cherry-picking
  changeNote: z.string().max(500).optional(),
});

export type CherryPickDTO = z.infer<typeof CherryPickDTOSchema>;

// ─── Diff Hunk (for client-side diff display) ─────────────────────────────────

/**
 * Represents a single change (hunk) in the diff.
 * Used by the frontend for line-by-line navigation.
 */
export const DiffHunkSchema = z.object({
  index: z.number().int(),                   // Unique index for this hunk
  type: z.enum(['added', 'removed', 'modified']),
  fromLineStart: z.number().int().optional(), // Line number in "from" version
  fromLineEnd: z.number().int().optional(),
  toLineStart: z.number().int().optional(),   // Line number in "to" version
  toLineEnd: z.number().int().optional(),
  fromContent: z.string().optional(),         // Content in older version
  toContent: z.string().optional(),           // Content in newer version
});

export type DiffHunk = z.infer<typeof DiffHunkSchema>;
