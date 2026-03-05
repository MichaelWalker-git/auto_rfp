import { z } from 'zod';

// ─── Submission Status ────────────────────────────────────────────────────────

export const ProposalSubmissionStatusSchema = z.enum([
  'SUBMITTED',    // Successfully submitted to the agency
  'WITHDRAWN',    // Submission was withdrawn after submission
]);
export type ProposalSubmissionStatus = z.infer<typeof ProposalSubmissionStatusSchema>;

// ─── Submission Method ────────────────────────────────────────────────────────

export const SubmissionMethodSchema = z.enum([
  'PORTAL',           // Submitted via agency portal (SAM.gov, beta.SAM.gov, etc.)
  'EMAIL',            // Submitted via email to contracting officer
  'MANUAL',           // Submitted manually outside the system (tracked here for record)
  'HAND_DELIVERY',    // Physical hand delivery to contracting office
  'OTHER',            // Other method
]);
export type SubmissionMethod = z.infer<typeof SubmissionMethodSchema>;

// ─── Readiness Check Item ─────────────────────────────────────────────────────

export const ReadinessCheckItemSchema = z.object({
  id:          z.string().min(1),
  label:       z.string().min(1),
  description: z.string().optional(),
  passed:      z.boolean(),
  /** Detail message — explains what's missing or what's good */
  detail:      z.string().optional(),
  /** Blocking = submission cannot proceed if false. Non-blocking = warning only. */
  blocking:    z.boolean().default(true),
});
export type ReadinessCheckItem = z.infer<typeof ReadinessCheckItemSchema>;

// ─── Submission Readiness Response ───────────────────────────────────────────

export const SubmissionReadinessResponseSchema = z.object({
  ready:         z.boolean(),
  checks:        z.array(ReadinessCheckItemSchema),
  blockingFails: z.number().int().nonnegative(),
  warningFails:  z.number().int().nonnegative(),
});
export type SubmissionReadinessResponse = z.infer<typeof SubmissionReadinessResponseSchema>;

// ─── Proposal Submission Record (stored in DynamoDB) ─────────────────────────

export const ProposalSubmissionItemSchema = z.object({
  // Identity
  submissionId: z.string().uuid(),
  orgId:        z.string().min(1),
  projectId:    z.string().min(1),
  oppId:        z.string().min(1),

  // Submission details
  status:           ProposalSubmissionStatusSchema,
  submissionMethod: SubmissionMethodSchema,
  submittedAt:      z.string().datetime(),
  submittedBy:      z.string().min(1),   // userId
  submittedByName:  z.string().optional(),

  // Submission metadata — captured at time of submission
  submissionReference: z.string().optional(),  // Agency confirmation / tracking number
  submissionNotes:     z.string().max(2000).optional(),
  portalUrl:           z.string().url().optional(),  // Link to agency portal submission

  // Document snapshot — IDs of documents included in this submission
  documentIds: z.array(z.string()).default([]),

  // Deadline at time of submission (snapshot for historical record)
  deadlineIso: z.string().datetime().optional(),

  // Withdrawal info (if status = WITHDRAWN)
  withdrawnAt:      z.string().datetime().optional(),
  withdrawnBy:      z.string().optional(),
  withdrawalReason: z.string().max(1000).optional(),

  // Audit
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProposalSubmissionItem = z.infer<typeof ProposalSubmissionItemSchema>;

// ─── Submit Proposal DTO ──────────────────────────────────────────────────────

export const SubmitProposalSchema = z.object({
  orgId:               z.string().min(1),
  projectId:           z.string().min(1),
  oppId:               z.string().min(1),
  submissionMethod:    SubmissionMethodSchema,
  submissionReference: z.string().optional(),
  submissionNotes:     z.string().max(2000).optional(),
  portalUrl:           z.string().url().optional(),
  /** Explicitly include specific document IDs; if omitted, all non-deleted docs are included */
  documentIds:         z.array(z.string()).optional(),
  /** Skip non-blocking warnings (deadline passed, already submitted) */
  forceSubmit:         z.boolean().optional().default(false),
});
export type SubmitProposal = z.infer<typeof SubmitProposalSchema>;

// ─── Withdraw Submission DTO ──────────────────────────────────────────────────

export const WithdrawSubmissionSchema = z.object({
  orgId:            z.string().min(1),
  projectId:        z.string().min(1),
  oppId:            z.string().min(1),
  submissionId:     z.string().uuid(),
  withdrawalReason: z.string().max(1000).optional(),
});
export type WithdrawSubmission = z.infer<typeof WithdrawSubmissionSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const SubmitProposalResponseSchema = z.object({
  ok:         z.boolean(),
  submission: ProposalSubmissionItemSchema,
});
export type SubmitProposalResponse = z.infer<typeof SubmitProposalResponseSchema>;

export const ProposalSubmissionHistoryResponseSchema = z.object({
  items: z.array(ProposalSubmissionItemSchema),
  count: z.number(),
});
export type ProposalSubmissionHistoryResponse = z.infer<typeof ProposalSubmissionHistoryResponseSchema>;
