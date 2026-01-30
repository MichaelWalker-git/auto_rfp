import { z } from 'zod';
import { EvaluationScoresSchema } from './project-outcome';

/**
 * Debriefing Request Status
 */
export const DebriefingStatusSchema = z.enum([
  'NOT_REQUESTED',
  'REQUESTED',
  'SCHEDULED',
  'COMPLETED',
  'DECLINED',
]);

export type DebriefingStatus = z.infer<typeof DebriefingStatusSchema>;

/**
 * Debriefing Request Method
 */
export const DebriefingRequestMethodSchema = z.enum(['EMAIL', 'PHONE', 'PORTAL']);

export type DebriefingRequestMethod = z.infer<typeof DebriefingRequestMethodSchema>;

/**
 * Debriefing Location Type
 */
export const DebriefingLocationTypeSchema = z.enum(['VIRTUAL', 'IN_PERSON', 'PHONE']);

export type DebriefingLocationType = z.infer<typeof DebriefingLocationTypeSchema>;

/**
 * Debriefing Item - the complete debriefing record
 */
export const DebriefingItemSchema = z.object({
  debriefId: z.string().uuid(),
  projectId: z.string().min(1),
  orgId: z.string().min(1),

  // Request tracking
  requestStatus: DebriefingStatusSchema,
  requestDeadline: z.string().datetime({ offset: true }),
  requestSentDate: z.string().datetime({ offset: true }).optional(),
  requestMethod: DebriefingRequestMethodSchema.optional(),

  // Scheduling
  scheduledDate: z.string().datetime({ offset: true }).optional(),
  locationType: DebriefingLocationTypeSchema.optional(),
  location: z.string().optional(),
  meetingLink: z.string().url().optional(),
  attendees: z.array(z.string().min(1)).optional(),

  // Notes and outcomes
  notes: z.string().optional(),
  strengthsIdentified: z.array(z.string().min(1)).optional(),
  weaknessesIdentified: z.array(z.string().min(1)).optional(),
  evaluationScores: EvaluationScoresSchema.optional(),
  keyTakeaways: z.string().optional(),

  // Metadata
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  createdBy: z.string().min(1),
});

export type DebriefingItem = z.infer<typeof DebriefingItemSchema>;

/**
 * Create Debriefing Request DTO
 */
export const CreateDebriefingRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  orgId: z.string().min(1, 'Organization ID is required'),
  requestDeadline: z.string().datetime({ offset: true }).optional(),
});

export type CreateDebriefingRequest = z.infer<typeof CreateDebriefingRequestSchema>;

/**
 * Update Debriefing Request DTO
 */
export const UpdateDebriefingRequestSchema = z.object({
  requestStatus: DebriefingStatusSchema.optional(),
  requestSentDate: z.string().datetime({ offset: true }).optional(),
  requestMethod: DebriefingRequestMethodSchema.optional(),
  scheduledDate: z.string().datetime({ offset: true }).optional(),
  locationType: DebriefingLocationTypeSchema.optional(),
  location: z.string().optional(),
  meetingLink: z.string().url().optional(),
  attendees: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  strengthsIdentified: z.array(z.string().min(1)).optional(),
  weaknessesIdentified: z.array(z.string().min(1)).optional(),
  evaluationScores: EvaluationScoresSchema.optional(),
  keyTakeaways: z.string().optional(),
});

export type UpdateDebriefingRequest = z.infer<typeof UpdateDebriefingRequestSchema>;

/**
 * Get Debriefing Response
 */
export const GetDebriefingResponseSchema = z.object({
  debriefing: DebriefingItemSchema.nullable(),
});

export type GetDebriefingResponse = z.infer<typeof GetDebriefingResponseSchema>;

/**
 * Generate Debriefing Letter Request
 */
export const GenerateDebriefingLetterRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  orgId: z.string().min(1, 'Organization ID is required'),
});

export type GenerateDebriefingLetterRequest = z.infer<typeof GenerateDebriefingLetterRequestSchema>;

/**
 * Generate Debriefing Letter Response
 */
export const GenerateDebriefingLetterResponseSchema = z.object({
  letterUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
});

export type GenerateDebriefingLetterResponse = z.infer<typeof GenerateDebriefingLetterResponseSchema>;

/**
 * Calculate debriefing request deadline (3 business days from notification)
 */
export function calculateDebriefingDeadline(notificationDate: Date): Date {
  const deadline = new Date(notificationDate);
  let businessDays = 0;

  while (businessDays < 3) {
    deadline.setDate(deadline.getDate() + 1);
    const dayOfWeek = deadline.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
  }

  return deadline;
}
