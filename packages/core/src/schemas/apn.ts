import { z } from 'zod';

// ─── ACE Opportunity Lifecycle Stage ──────────────────────────────────────────

/**
 * AWS Partner Central opportunity lifecycle stages. The values are the exact
 * `LifeCycle.Stage` strings the Partner Central Selling API accepts, so the
 * stored value is sent to the API verbatim — no mapping layer.
 */
export const AceStageSchema = z.enum([
  'Prospect',
  'Qualified',
  'Technical Validation',
  'Business Validation',
  'Committed',
  'Launched',
  'Closed Lost',
]);
export type AceStage = z.infer<typeof AceStageSchema>;

/** Lifecycle order, used to render the stage dropdown. */
export const ACE_STAGE_ORDER: readonly AceStage[] = [
  'Prospect',
  'Qualified',
  'Technical Validation',
  'Business Validation',
  'Committed',
  'Launched',
  'Closed Lost',
];

/**
 * One ACE stage change. `AUTO_SUBMITTED` marks the automatic
 * 'Technical Validation' set when an RFP is marked submitted on the Linear
 * board (creates the Partner Central opportunity); `MANUAL` marks a dropdown
 * change from the board; `GATE_APPROVAL` is the legacy gate-1 provenance,
 * retained for records created before submitted became the only ACE trigger.
 */
export const AceStageTransitionSchema = z.object({
  from: AceStageSchema.nullable(),
  to: AceStageSchema,
  changedAt: z.string().datetime(),
  changedBy: z.string().min(1),
  source: z.enum(['GATE_APPROVAL', 'MANUAL', 'AUTO_SUBMITTED']),
});
export type AceStageTransition = z.infer<typeof AceStageTransitionSchema>;

// ─── ACE Submission State Machine ─────────────────────────────────────────────

/**
 * State of the automatic "advance to Technical Validation" pipeline for one
 * opportunity. AWS Partner Central makes this inherently async and multi-step:
 * a new opportunity is locked at Prospect / ReviewStatus=`Pending Submission`,
 * and its stage only becomes editable after it is submitted to AWS review and
 * AWS approves it. This value tracks where a given opportunity is in that walk.
 *
 *   NONE               — no submission started (default).
 *   ENGAGEMENT_PENDING — StartEngagementFromOpportunityTask fired; polling the
 *                        async task (TaskStatus IN_PROGRESS) for an EngagementId.
 *   ENGAGED            — engagement task COMPLETE; ready to SubmitOpportunity.
 *   SUBMITTED          — SubmitOpportunity called; ReviewStatus=`Submitted`.
 *   IN_REVIEW          — AWS is validating (ReviewStatus=`In review`).
 *   ACTION_REQUIRED    — AWS needs changes (ReviewStatus=`Action Required`);
 *                        paused for a human, surfaced on the board.
 *   APPROVED           — AWS approved (ReviewStatus=`Approved`); stage now editable.
 *   ADVANCED           — UpdateOpportunity set the stage to Technical Validation
 *                        (terminal success).
 *   REJECTED           — AWS disqualified the opportunity (terminal).
 *   FAILED             — the engagement task FAILED or a hard API error (terminal
 *                        until manually retried); see aceSubmissionError.
 */
export const AceSubmissionStateSchema = z.enum([
  'NONE',
  'ENGAGEMENT_PENDING',
  'ENGAGED',
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_REQUIRED',
  'APPROVED',
  'ADVANCED',
  'REJECTED',
  'FAILED',
]);
export type AceSubmissionState = z.infer<typeof AceSubmissionStateSchema>;

/** States the poller no longer needs to touch. */
export const ACE_SUBMISSION_TERMINAL_STATES: readonly AceSubmissionState[] = [
  'ADVANCED',
  'REJECTED',
  'FAILED',
];

/**
 * Per-opportunity progress record for the submit→review→advance pipeline.
 * Stored on the opportunity item as `aceSubmission`. Every field is optional so
 * partial progress is representable and the object is safe to merge forward.
 */
export const AceSubmissionSchema = z.object({
  state: AceSubmissionStateSchema,
  /** TaskId from StartEngagementFromOpportunityTask (oit-…), polled for completion. */
  taskId: z.string().optional(),
  /** EngagementId once the task completes. */
  engagementId: z.string().optional(),
  /** Last observed Partner Central LifeCycle.ReviewStatus (verbatim string). */
  reviewStatus: z.string().optional(),
  /** Human-facing reason/comments from AWS (Action Required / Rejected). Display only. */
  reviewComments: z.string().optional(),
  /** Last error message from a failed step (display only — never parsed). */
  error: z.string().nullish(),
  /** ISO datetime of the last state transition. */
  lastStepAt: z.string().datetime().optional(),
  /** Number of poller ticks spent on the current step (loop/backoff guard). */
  attempts: z.number().int().nonnegative().optional(),
});
export type AceSubmission = z.infer<typeof AceSubmissionSchema>;

/** POST /dashboard/update-ace-stage request body. */
export const UpdateAceStageSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  aceStage: AceStageSchema,
});
export type UpdateAceStage = z.infer<typeof UpdateAceStageSchema>;

// ─── APN Registration Status ──────────────────────────────────────────────────

export const ApnRegistrationStatusSchema = z.enum([
  'PENDING',       // Registration queued but not yet attempted
  'REGISTERED',    // Successfully registered in Partner Portal
  'FAILED',        // Registration attempt failed
  'RETRYING',      // Manual retry in progress
]);
export type ApnRegistrationStatus = z.infer<typeof ApnRegistrationStatusSchema>;

// ─── AWS Services Involved ────────────────────────────────────────────────────

export const AwsServiceSchema = z.enum([
  'EC2', 'S3', 'RDS', 'Lambda', 'ECS', 'EKS', 'SageMaker',
  'Bedrock', 'DynamoDB', 'CloudFront', 'API_Gateway', 'Cognito',
  'Step_Functions', 'SNS', 'SQS', 'Kinesis', 'Glue', 'Athena',
  'QuickSight', 'Connect', 'Lex', 'Rekognition', 'Textract',
  'Comprehend', 'Translate', 'Polly', 'Transcribe', 'Other',
]);
export type AwsService = z.infer<typeof AwsServiceSchema>;

// ─── APN Registration Item (stored in DynamoDB) ───────────────────────────────

export const ApnRegistrationItemSchema = z.object({
  // Identity
  registrationId: z.string().uuid(),
  orgId:          z.string().min(1),
  projectId:      z.string().min(1),
  oppId:          z.string().min(1),

  // Registration status
  status:         ApnRegistrationStatusSchema,
  apnOpportunityId: z.string().optional(),   // ID returned by Partner Central API
  apnOpportunityUrl: z.string().url().optional(), // Deep-link into Partner Portal

  // Opportunity fields sent to APN
  customerName:       z.string().min(1),
  opportunityValue:   z.number().nonnegative(),
  awsServices:        z.array(AwsServiceSchema).min(1),
  expectedCloseDate:  z.string().datetime(),
  proposalStatus:     z.enum(['PROSPECT', 'SUBMITTED', 'WON', 'LOST']),
  description:        z.string().max(2000).optional(),

  // Error tracking
  lastError:          z.string().optional(),
  retryCount:         z.number().int().nonnegative().default(0),
  lastAttemptAt:      z.string().datetime().optional(),

  // Audit
  registeredBy:       z.string().min(1),   // userId or 'system'
  createdAt:          z.string().datetime(),
  updatedAt:          z.string().datetime(),
});
export type ApnRegistrationItem = z.infer<typeof ApnRegistrationItemSchema>;

// ─── Create DTO ───────────────────────────────────────────────────────────────

export const CreateApnRegistrationSchema = ApnRegistrationItemSchema.omit({
  registrationId: true,
  status: true,
  apnOpportunityId: true,
  apnOpportunityUrl: true,
  lastError: true,
  retryCount: true,
  lastAttemptAt: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateApnRegistration = z.infer<typeof CreateApnRegistrationSchema>;

// ─── Retry DTO ────────────────────────────────────────────────────────────────

export const RetryApnRegistrationSchema = z.object({
  orgId:          z.string().min(1),
  projectId:      z.string().min(1),
  oppId:          z.string().min(1),
  registrationId: z.string().uuid(),
});
export type RetryApnRegistration = z.infer<typeof RetryApnRegistrationSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const ApnRegistrationResponseSchema = z.object({
  registration: ApnRegistrationItemSchema.nullable(),
});
export type ApnRegistrationResponse = z.infer<typeof ApnRegistrationResponseSchema>;

export const RetryApnRegistrationResponseSchema = z.object({
  ok:           z.boolean(),
  registration: ApnRegistrationItemSchema,
});
export type RetryApnRegistrationResponse = z.infer<typeof RetryApnRegistrationResponseSchema>;

export const ApnRegistrationsListResponseSchema = z.object({
  items: z.array(ApnRegistrationItemSchema),
  count: z.number(),
});
export type ApnRegistrationsListResponse = z.infer<typeof ApnRegistrationsListResponseSchema>;
