import { z } from 'zod';
import { OpportunityStatusSchema } from './opportunity';
import type { Industry, CountryCode } from '@aws-sdk/client-partnercentral-selling';

export const ApnRegistrationStatusSchema = z.enum([
  'PENDING',       // Registration queued but not yet attempted
  'REGISTERED',    // Successfully registered in Partner Portal
  'FAILED',        // Registration attempt failed
  'RETRYING',      // Manual retry in progress
]);
export type ApnRegistrationStatus = z.infer<typeof ApnRegistrationStatusSchema>;

export const AwsServiceSchema = z.enum([
  'EC2', 'S3', 'RDS', 'Lambda', 'ECS', 'EKS', 'SageMaker',
  'Bedrock', 'DynamoDB', 'CloudFront', 'API_Gateway', 'Cognito',
  'Step_Functions', 'SNS', 'SQS', 'Kinesis', 'Glue', 'Athena',
  'QuickSight', 'Connect', 'Lex', 'Rekognition', 'Textract',
  'Comprehend', 'Translate', 'Polly', 'Transcribe', 'Other',
]);
export type AwsService = z.infer<typeof AwsServiceSchema>;

export const ApnRegistrationItemSchema = z.object({
  // Identity
  registrationId: z.string().uuid(),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),

  // Registration status
  status: ApnRegistrationStatusSchema,
  apnOpportunityId: z.string().optional(),   // ID returned by Partner Central API
  apnOpportunityUrl: z.string().url().optional(), // Deep-link into Partner Portal

  // Opportunity fields sent to APN
  customerName: z.string().min(1),
  opportunityValue: z.number().nonnegative(),
  awsServices: z.array(AwsServiceSchema).min(1),
  expectedCloseDate: z.string().datetime(),
  proposalStatus: z.enum(['PROSPECT', 'SUBMITTED', 'WON', 'LOST']),
  description: z.string().max(2000).optional(),

  // Error tracking
  lastError: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  lastAttemptAt: z.string().datetime().optional(),

  // Audit
  registeredBy: z.string().min(1),   // userId or 'system'
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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

export const RetryApnRegistrationSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  registrationId: z.string().uuid(),
});
export type RetryApnRegistration = z.infer<typeof RetryApnRegistrationSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const ApnRegistrationResponseSchema = z.object({
  registration: ApnRegistrationItemSchema.nullable(),
});
export type ApnRegistrationResponse = z.infer<typeof ApnRegistrationResponseSchema>;

export const RetryApnRegistrationResponseSchema = z.object({
  ok: z.boolean(),
  registration: ApnRegistrationItemSchema,
});
export type RetryApnRegistrationResponse = z.infer<typeof RetryApnRegistrationResponseSchema>;

export const ApnRegistrationsListResponseSchema = z.object({
  items: z.array(ApnRegistrationItemSchema),
  count: z.number(),
});
export type ApnRegistrationsListResponse = z.infer<typeof ApnRegistrationsListResponseSchema>;

export const SyncToApnRequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),

  existingApnId: z
    .string()
    .regex(/^O[0-9]{1,19}$/)
    .optional(),

  opportunity: z.object({
    title: z.string().min(1),
    value: z.number().nonnegative(),
    expectedCloseDate: z.string().datetime(),
    status: OpportunityStatusSchema,
    description: z.string().optional(),
  }),

  customer: z.object({
    name: z.string().min(1),
    websiteUrl: z.string().url().optional(),
    industry: z.custom<Industry>().optional(),
    countryCode: z.custom<CountryCode>().optional(),
  }),

  apn: z.object({
    opportunityType: z
      .enum(['Net New Business', 'Flat Renewal', 'Expansion'])
      .optional(),

    marketing: z
      .object({
        source: z.enum(['Marketing Activity', 'None']),
        awsFundingUsed: z.enum(['Yes', 'No']).optional(),
        campaignName: z.string().optional(),
        channels: z.array(z.string()).optional(),
        useCases: z.array(z.string()).optional(),
      })
      .optional(),

    primaryNeedsFromAws: z.array(z.string()).optional(),
    nationalSecurity: z.enum(['Yes', 'No']).optional(),
  }).optional(),
});

export type SyncToApnRequest = z.infer<typeof SyncToApnRequestSchema>