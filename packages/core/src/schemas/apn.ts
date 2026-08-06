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
 * One ACE stage change. `GATE_APPROVAL` marks the automatic Prospect set on
 * gate-1 approve; `MANUAL` marks a dropdown change from the board.
 */
export const AceStageTransitionSchema = z.object({
  from: AceStageSchema.nullable(),
  to: AceStageSchema,
  changedAt: z.string().datetime(),
  changedBy: z.string().min(1),
  source: z.enum(['GATE_APPROVAL', 'MANUAL']),
});
export type AceStageTransition = z.infer<typeof AceStageTransitionSchema>;

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
