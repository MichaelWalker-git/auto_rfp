import { z } from 'zod';
import { RoleSchema } from './executive-opportunity-brief';

/**
 * Type of interaction with contracting officer
 */
export const EngagementTypeSchema = z.enum([
  'QUESTION_SUBMITTED', // Formal question submitted via official channel
  'RESPONSE_RECEIVED', // Response received from CO
  'PHONE_CALL', // Phone conversation with CO
  'SITE_VISIT', // Site visit or in-person meeting
  'MEETING', // Scheduled meeting (virtual or in-person)
  'OTHER', // Other types of engagement
]);

export type EngagementType = z.infer<typeof EngagementTypeSchema>;

export const EngagementDirectionSchema = z.enum([
  'OUTBOUND', 
  'INBOUND', 
]);

export type EngagementDirection = z.infer<typeof EngagementDirectionSchema>;

/**
 * Sentiment of the interaction (subjective assessment)
 */
export const EngagementSentimentSchema = z.enum([
  'POSITIVE', 
  'NEUTRAL', 
  'NEGATIVE', 
]);

export type EngagementSentiment = z.infer<typeof EngagementSentimentSchema>;

/**
 * Main schema for tracking engagement with contracting officers
 */
export const EngagementLogItemSchema = z.object({
  // Identifiers
  engagementId: z.string().uuid(),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),

  // Contact information (linked to contacts from ExecutiveBrief)
  contactEmail: z.string().email().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactRole: RoleSchema.optional().nullable(),

  // Interaction details
  interactionType: EngagementTypeSchema,
  interactionDate: z.string().datetime(),
  direction: EngagementDirectionSchema,
  summary: z.string().min(5, 'Summary must be at least 5 characters'),

  // Link to clarifying question (if this interaction is related to a submitted question)
  clarifyingQuestionId: z.string().uuid().optional().nullable(),

  // Outcome tracking
  sentiment: EngagementSentimentSchema.optional().nullable(),
  followUpRequired: z.boolean().default(false),
  followUpNotes: z.string().optional().nullable(),
  followUpDate: z.string().datetime().optional().nullable(),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EngagementLogItem = z.infer<typeof EngagementLogItemSchema>;

/**
 * Schema for creating a new engagement log entry (omits auto-generated fields)
 */
export const CreateEngagementLogSchema = EngagementLogItemSchema.omit({
  engagementId: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateEngagementLogDTO = z.infer<typeof CreateEngagementLogSchema>;

/**
 * Schema for updating an engagement log entry
 */
export const UpdateEngagementLogSchema = z.object({
  contactEmail: z.string().email().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactRole: RoleSchema.optional().nullable(),
  summary: z.string().min(5).optional(),
  sentiment: EngagementSentimentSchema.optional().nullable(),
  followUpRequired: z.boolean().optional(),
  followUpNotes: z.string().optional().nullable(),
  followUpDate: z.string().datetime().optional().nullable(),
});

export type UpdateEngagementLogDTO = z.infer<typeof UpdateEngagementLogSchema>;

/**
 * Response schema for listing engagement logs
 */
export const EngagementLogsResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(EngagementLogItemSchema),
  count: z.number().int().nonnegative(),
  nextToken: z.string().optional().nullable(),
});

export type EngagementLogsResponse = z.infer<typeof EngagementLogsResponseSchema>;

/**
 * Engagement metrics for an opportunity
 */
export const EngagementMetricsSchema = z.object({
  totalInteractions: z.number().int().nonnegative(),
  questionsSubmitted: z.number().int().nonnegative(),
  responsesReceived: z.number().int().nonnegative(),
  responseRate: z.number().min(0).max(100), // Percentage
  phoneCalls: z.number().int().nonnegative(),
  meetings: z.number().int().nonnegative(),
  siteVisits: z.number().int().nonnegative(),
  lastInteractionDate: z.string().datetime().optional().nullable(),
  averageResponseTimeDays: z.number().nonnegative().optional().nullable(),
});

export type EngagementMetrics = z.infer<typeof EngagementMetricsSchema>;

/**
 * Response schema for engagement metrics
 */
export const EngagementMetricsResponseSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  opportunityId: z.string(),
  metrics: EngagementMetricsSchema,
});

export type EngagementMetricsResponse = z.infer<typeof EngagementMetricsResponseSchema>;
