import { z } from 'zod';

// ─── Approval Status ──────────────────────────────────────────────────────────

export const DocumentApprovalStatusSchema = z.enum([
  'PENDING',    // Approval request sent, waiting for reviewer
  'APPROVED',   // Reviewer approved the document
  'REJECTED',   // Reviewer rejected the document
  'CANCELLED',  // Requester cancelled the approval request
]);
export type DocumentApprovalStatus = z.infer<typeof DocumentApprovalStatusSchema>;

// ─── Document Approval Record (stored in DynamoDB) ───────────────────────────

export const DocumentApprovalItemSchema = z.object({
  approvalId:   z.string().uuid(),
  orgId:        z.string().min(1),
  projectId:    z.string().min(1),
  opportunityId: z.string().min(1),
  documentId:   z.string().min(1),
  documentName: z.string().optional(),

  status: DocumentApprovalStatusSchema,

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

  // Linear ticket created for the reviewer
  linearTicketId:         z.string().optional(),
  linearTicketIdentifier: z.string().optional(),
  linearTicketUrl:        z.string().url().optional(),

  // Audit
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DocumentApprovalItem = z.infer<typeof DocumentApprovalItemSchema>;

// ─── Request Approval DTO ─────────────────────────────────────────────────────

export const RequestDocumentApprovalSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1),
  opportunityId: z.string().min(1),
  documentId:    z.string().min(1),
  reviewerId:    z.string().min(1),   // userId of the reviewer (cannot be self)
});
export type RequestDocumentApproval = z.infer<typeof RequestDocumentApprovalSchema>;

// ─── Submit Review DTO ────────────────────────────────────────────────────────

export const SubmitDocumentReviewSchema = z.discriminatedUnion('decision', [
  z.object({
    orgId:         z.string().min(1),
    projectId:     z.string().min(1),
    opportunityId: z.string().min(1),
    documentId:    z.string().min(1),
    approvalId:    z.string().uuid(),
    decision:      z.literal('APPROVED'),
    reviewNote:    z.string().max(2000).optional(),
  }),
  z.object({
    orgId:         z.string().min(1),
    projectId:     z.string().min(1),
    opportunityId: z.string().min(1),
    documentId:    z.string().min(1),
    approvalId:    z.string().uuid(),
    decision:      z.literal('REJECTED'),
    reviewNote:    z.string().min(1, 'Rejection reason is required').max(2000),
  }),
]);
export type SubmitDocumentReview = z.infer<typeof SubmitDocumentReviewSchema>;

// ─── Cancel Approval DTO ──────────────────────────────────────────────────────

export const CancelDocumentApprovalSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1),
  opportunityId: z.string().min(1),
  documentId:    z.string().min(1),
  approvalId:    z.string().uuid(),
});
export type CancelDocumentApproval = z.infer<typeof CancelDocumentApprovalSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const DocumentApprovalResponseSchema = z.object({
  approval: DocumentApprovalItemSchema,
});
export type DocumentApprovalResponse = z.infer<typeof DocumentApprovalResponseSchema>;

export const DocumentApprovalHistoryResponseSchema = z.object({
  items: z.array(DocumentApprovalItemSchema),
  count: z.number(),
  /** The most recent active (PENDING) approval, if any */
  activeApproval: DocumentApprovalItemSchema.nullable(),
});
export type DocumentApprovalHistoryResponse = z.infer<typeof DocumentApprovalHistoryResponseSchema>;
