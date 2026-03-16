import { z } from 'zod';

// ─── Universal Approval Status ───────────────────────────────────────────────

export const UniversalApprovalStatusSchema = z.enum([
  'PENDING',              // Approval request sent, waiting for reviewer
  'APPROVED',             // Reviewer approved the entity
  'REJECTED',             // Reviewer rejected the entity
  'REVISION_REQUESTED',   // Employee fixed entity, re-submitted for review (→ PENDING)
  'CANCELLED',            // Requester cancelled the approval request
]);
export type UniversalApprovalStatus = z.infer<typeof UniversalApprovalStatusSchema>;

// ─── Entity Types that can be approved ───────────────────────────────────────

export const ApprovableEntityTypeSchema = z.enum([
  'rfp-document',         // RFP documents (backward compatibility)
  'brief',                // Executive opportunity briefs
  'opportunity',          // Opportunities
  'submission',           // Proposal submissions
  'content-library',      // Content library items
  'template',             // Templates
  'foia-request',         // FOIA requests
  'debriefing-request',   // Debriefing requests
]);
export type ApprovableEntityType = z.infer<typeof ApprovableEntityTypeSchema>;

// ─── Universal Approval Record (stored in DynamoDB) ──────────────────────────

export const UniversalApprovalItemSchema = z.object({
  approvalId:   z.string().uuid(),
  orgId:        z.string().min(1),
  projectId:    z.string().min(1).optional(), // Some entities might not be project-scoped
  
  // Universal entity identification
  entityType:   ApprovableEntityTypeSchema,
  entityId:     z.string().min(1),           // The ID of the entity being approved
  entitySK:     z.string().min(1),           // The full SK of the entity in DynamoDB
  entityName:   z.string().optional(),       // Display name of the entity
  
  // Legacy fields for backward compatibility with RFP documents
  opportunityId: z.string().min(1).optional(),
  documentId:    z.string().min(1).optional(),
  documentName:  z.string().optional(),

  status: UniversalApprovalStatusSchema,

  // Who requested the approval
  requestedBy:     z.string().min(1),   // userId
  requestedByName: z.string().optional(),
  requestedAt:     z.string().datetime(),

  // Who is assigned to review
  reviewerId:     z.string().min(1),    // userId
  reviewerName:   z.string().optional(),
  reviewerEmail:  z.string().email().optional(),

  // Review outcome
  reviewedAt:     z.string().datetime().optional(),
  reviewNote:     z.string().max(2000).optional(),

  // Revision (set when employee re-submits after rejection)
  revisionNote:   z.string().max(2000).optional(),

  // Workflow context
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  deadline: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),

  // Linear ticket created for the reviewer
  linearTicketId:         z.string().optional(),
  linearTicketIdentifier: z.string().optional(),
  linearTicketUrl:        z.string().url().optional(),

  // Audit
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UniversalApprovalItem = z.infer<typeof UniversalApprovalItemSchema>;

// ─── Request Universal Approval DTO ──────────────────────────────────────────

export const RequestUniversalApprovalSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1).optional(),
  entityType:    ApprovableEntityTypeSchema,
  entityId:      z.string().min(1),
  entitySK:      z.string().min(1),
  entityName:    z.string().optional(),
  reviewerId:    z.string().min(1),   // userId of the reviewer (cannot be self)
  
  // Legacy fields for backward compatibility
  opportunityId: z.string().min(1).optional(),
  documentId:    z.string().min(1).optional(),
});
export type RequestUniversalApproval = z.infer<typeof RequestUniversalApprovalSchema>;

// ─── Submit Universal Review DTO ─────────────────────────────────────────────

export const SubmitUniversalReviewSchema = z.discriminatedUnion('decision', [
  z.object({
    orgId:         z.string().min(1),
    projectId:     z.string().min(1).optional(),
    entityType:    ApprovableEntityTypeSchema,
    entityId:      z.string().min(1),
    approvalId:    z.string().uuid(),
    decision:      z.literal('APPROVED'),
    reviewNote:    z.string().max(2000).optional(),
    
    // Legacy fields for backward compatibility
    opportunityId: z.string().min(1).optional(),
    documentId:    z.string().min(1).optional(),
  }),
  z.object({
    orgId:         z.string().min(1),
    projectId:     z.string().min(1).optional(),
    entityType:    ApprovableEntityTypeSchema,
    entityId:      z.string().min(1),
    approvalId:    z.string().uuid(),
    decision:      z.literal('REJECTED'),
    reviewNote:    z.string().min(1, 'Rejection reason is required').max(2000),
    
    // Legacy fields for backward compatibility
    opportunityId: z.string().min(1).optional(),
    documentId:    z.string().min(1).optional(),
  }),
]);
export type SubmitUniversalReview = z.infer<typeof SubmitUniversalReviewSchema>;

// ─── Cancel Universal Approval DTO ───────────────────────────────────────────

export const CancelUniversalApprovalSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1).optional(),
  entityType:    ApprovableEntityTypeSchema,
  entityId:      z.string().min(1),
  approvalId:    z.string().uuid(),
  
  // Legacy fields for backward compatibility
  opportunityId: z.string().min(1).optional(),
  documentId:    z.string().min(1).optional(),
});
export type CancelUniversalApproval = z.infer<typeof CancelUniversalApprovalSchema>;

// ─── Re-Submit for Universal Review DTO ──────────────────────────────────────

export const ResubmitForUniversalReviewSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1).optional(),
  entityType:    ApprovableEntityTypeSchema,
  entityId:      z.string().min(1),
  approvalId:    z.string().uuid(),
  revisionNote:  z.string().max(2000).optional(),
  
  // Legacy fields for backward compatibility
  opportunityId: z.string().min(1).optional(),
  documentId:    z.string().min(1).optional(),
});
export type ResubmitForUniversalReview = z.infer<typeof ResubmitForUniversalReviewSchema>;

// ─── API Response Types ──────────────────────────────────────────────────────

export const UniversalApprovalResponseSchema = z.object({
  approval: UniversalApprovalItemSchema,
});
export type UniversalApprovalResponse = z.infer<typeof UniversalApprovalResponseSchema>;

export const UniversalApprovalHistoryResponseSchema = z.object({
  items: z.array(UniversalApprovalItemSchema),
  count: z.number(),
  /** The most recent active (PENDING) approval, if any */
  activeApproval: UniversalApprovalItemSchema.nullable(),
});
export type UniversalApprovalHistoryResponse = z.infer<typeof UniversalApprovalHistoryResponseSchema>;

// ─── Bulk Universal Review DTOs ──────────────────────────────────────────────

export const BulkUniversalReviewItemSchema = z.discriminatedUnion('decision', [
  z.object({
    entityType:    ApprovableEntityTypeSchema,
    entityId:      z.string().min(1),
    approvalId:    z.string().uuid(),
    decision:      z.literal('APPROVED'),
    reviewNote:    z.string().max(2000).optional(),
    
    // Legacy fields for backward compatibility
    documentId:    z.string().min(1).optional(),
  }),
  z.object({
    entityType:    ApprovableEntityTypeSchema,
    entityId:      z.string().min(1),
    approvalId:    z.string().uuid(),
    decision:      z.literal('REJECTED'),
    reviewNote:    z.string().min(1, 'Rejection reason is required').max(2000),
    
    // Legacy fields for backward compatibility
    documentId:    z.string().min(1).optional(),
  }),
]);
export type BulkUniversalReviewItem = z.infer<typeof BulkUniversalReviewItemSchema>;

export const BulkSubmitUniversalReviewSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1).optional(),
  reviews:       z.array(BulkUniversalReviewItemSchema).min(1).max(50),
  
  // Legacy fields for backward compatibility
  opportunityId: z.string().min(1).optional(),
});
export type BulkSubmitUniversalReview = z.infer<typeof BulkSubmitUniversalReviewSchema>;

export const BulkUniversalReviewResponseSchema = z.object({
  results: z.array(z.object({
    entityType:    ApprovableEntityTypeSchema,
    entityId:      z.string(),
    approvalId:    z.string(),
    decision:      z.enum(['APPROVED', 'REJECTED']),
    success:       z.boolean(),
    error:         z.string().optional(),
    
    // Legacy fields for backward compatibility
    documentId:    z.string().optional(),
  })),
  totalApproved: z.number(),
  totalRejected: z.number(),
  totalFailed:   z.number(),
});
export type BulkUniversalReviewResponse = z.infer<typeof BulkUniversalReviewResponseSchema>;

// ─── Enhanced Schemas for UI Improvements ────────────────────────────────────

// Enhanced user information for better context
export const UniversalApprovalUserInfoSchema = z.object({
  userId: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  avatar: z.string().url().optional(),
  role: z.string().optional(),
  department: z.string().optional(),
});
export type UniversalApprovalUserInfo = z.infer<typeof UniversalApprovalUserInfoSchema>;

// Enhanced approval item with richer user context
export const EnhancedUniversalApprovalItemSchema = UniversalApprovalItemSchema.extend({
  // Enhanced requester information
  requesterInfo: UniversalApprovalUserInfoSchema.optional(),
  
  // Enhanced reviewer information
  reviewerInfo: UniversalApprovalUserInfoSchema.optional(),
  
  // Entity context
  entitySize: z.number().optional(),
  entityVersion: z.number().optional(),
  
  // Workflow context
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  deadline: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  
  // Approval metrics
  timeToReview: z.number().optional(), // minutes from request to review
  isOverdue: z.boolean().default(false),
});
export type EnhancedUniversalApprovalItem = z.infer<typeof EnhancedUniversalApprovalItemSchema>;

// Enhanced API response with summary statistics and user context
export const EnhancedUniversalApprovalHistoryResponseSchema = z.object({
  items: z.array(EnhancedUniversalApprovalItemSchema),
  count: z.number(),
  activeApproval: EnhancedUniversalApprovalItemSchema.nullable(),
  
  // Summary statistics
  summary: z.object({
    totalPending: z.number(),
    totalApproved: z.number(),
    totalRejected: z.number(),
    averageReviewTime: z.number().optional(), // in minutes
    overdueCount: z.number(),
  }),
  
  // User-specific context
  userContext: z.object({
    isRequester: z.boolean(),
    isReviewer: z.boolean(),
    hasActionItems: z.boolean(),
    nextAction: z.string().optional(),
  }),
});
export type EnhancedUniversalApprovalHistoryResponse = z.infer<typeof EnhancedUniversalApprovalHistoryResponseSchema>;

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Convert legacy document approval to universal approval format
 */
export const convertDocumentApprovalToUniversal = (
  documentApproval: any
): UniversalApprovalItem => {
  return {
    ...documentApproval,
    entityType: 'rfp-document' as const,
    entityId: documentApproval.documentId,
    entitySK: `${documentApproval.orgId}#${documentApproval.projectId}#${documentApproval.opportunityId}#${documentApproval.documentId}`,
    entityName: documentApproval.documentName,
  };
};

/**
 * Get entity display name based on type
 */
export const getEntityDisplayName = (entityType: ApprovableEntityType): string => {
  const displayNames: Record<ApprovableEntityType, string> = {
    'rfp-document': 'RFP Document',
    'brief': 'Executive Brief',
    'opportunity': 'Opportunity',
    'submission': 'Proposal Submission',
    'content-library': 'Content Library Item',
    'template': 'Template',
    'foia-request': 'FOIA Request',
    'debriefing-request': 'Debriefing Request',
  };
  return displayNames[entityType];
};

/**
 * Get entity icon based on type
 */
export const getEntityIcon = (entityType: ApprovableEntityType): string => {
  const icons: Record<ApprovableEntityType, string> = {
    'rfp-document': '📄',
    'brief': '📋',
    'opportunity': '🎯',
    'submission': '📤',
    'content-library': '📚',
    'template': '📝',
    'foia-request': '🔍',
    'debriefing-request': '📊',
  };
  return icons[entityType];
};

/**
 * Convert entity type to audit resource type
 */
export const getAuditResourceType = (entityType: ApprovableEntityType) => {
  const auditResourceMap = {
    'rfp-document': 'rfp_document',
    'brief': 'brief',
    'opportunity': 'opportunity',
    'submission': 'submission',
    'content-library': 'content_library',
    'template': 'template',
    'foia-request': 'foia_request',
    'debriefing-request': 'debriefing_request',
  } as const;
  return auditResourceMap[entityType];
};
