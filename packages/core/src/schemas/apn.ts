import { z } from 'zod';

// ─── APN Registration Status ──────────────────────────────────────────────────

export const ApnRegistrationStatusSchema = z.enum([
  'PENDING',       // Registration queued but not yet attempted
  'REGISTERED',    // Successfully registered in Partner Portal
  'FAILED',        // Registration attempt failed
  'RETRYING',      // Manual retry in progress
  'NOT_CONFIGURED', // No APN credentials configured for this org
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
  proposalStatus:     z.enum(['SUBMITTED', 'WON', 'LOST']),
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

// ─── Credentials DTO ─────────────────────────────────────────────────────────

export const SaveApnCredentialsSchema = z.object({
  orgId:          z.string().min(1),
  partnerId:      z.string().min(1, 'AWS Partner ID is required'),
  accessKeyId:    z.string().min(16, 'AWS Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
  /** Optional: AWS region for Partner Central API (default: us-east-1) */
  region:         z.string().optional().default('us-east-1'),
});
export type SaveApnCredentials = z.infer<typeof SaveApnCredentialsSchema>;

export const GetApnCredentialsResponseSchema = z.object({
  configured: z.boolean(),
  partnerId:  z.string().optional(),
  region:     z.string().optional(),
  configuredAt: z.string().datetime().optional(),
});
export type GetApnCredentialsResponse = z.infer<typeof GetApnCredentialsResponseSchema>;

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
