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

  // Solicitation / contract details (optional for backward compat with existing records)
  solicitationNumber: z.string().optional(),
  contractNumber: z.string().optional(),
  contractTitle: z.string().optional(),
  awardedOrganization: z.string().optional(),
  awardNotificationDate: z.string().optional(),

  // Contracting officer (optional for backward compat)
  contractingOfficerName: z.string().optional(),
  contractingOfficerEmail: z.string().email().optional(),
  contractingOfficerAddress: z.string().optional(),

  // Requester information (optional for backward compat)
  requesterName: z.string().optional(),
  requesterTitle: z.string().optional(),
  requesterEmail: z.string().email().optional(),
  requesterAddress: z.string().optional(),
  companyName: z.string().optional(),

  // Optional attached questions
  attachedQuestions: z.string().optional(),

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
  opportunityId: z.string().min(1, 'Opportunity ID is required'),

  // Solicitation / contract details
  solicitationNumber: z.string().min(1, 'Solicitation number is required'),
  contractNumber: z.string().min(1, 'Contract number is required'),
  contractTitle: z.string().min(1, 'Contract title is required'),
  awardedOrganization: z.string().min(1, 'Awarded organization is required'),
  awardNotificationDate: z.string().min(1, 'Award notification date is required'),

  // Contracting officer
  contractingOfficerName: z.string().min(1, 'Contracting officer name is required'),
  contractingOfficerEmail: z.string().email('Valid contracting officer email is required'),
  contractingOfficerAddress: z.string().min(1, 'Contracting officer address is required'),

  // Requester information
  requesterName: z.string().min(1, 'Requester name is required'),
  requesterTitle: z.string().min(1, 'Requester title is required'),
  requesterEmail: z.string().email('Valid requester email is required'),
  requesterAddress: z.string().min(1, 'Requester address is required'),
  companyName: z.string().min(1, 'Company name is required'),

  // Optional attached questions
  attachedQuestions: z.string().optional(),
});

export type CreateDebriefingRequest = z.infer<typeof CreateDebriefingRequestSchema>;

/**
 * Auto-generated email subject — not a schema field, derived at send time
 */
export const generateDebriefingEmailSubject = (data: CreateDebriefingRequest): string =>
  `POST-AWARD DEBRIEFING REQUEST — Solicitation No. ${data.solicitationNumber} | Contract No. ${data.contractNumber}`;

/**
 * Update Debriefing Request DTO
 */
export const UpdateDebriefingRequestSchema = z.object({
  debriefingId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  status: DebriefingStatusSchema.optional(),
  requestStatus: DebriefingStatusSchema.optional(),
  requestSentDate: z.string().datetime({ offset: true }).optional(),
  requestMethod: DebriefingRequestMethodSchema.optional(),

  // Solicitation / contract details
  solicitationNumber: z.string().optional(),
  contractNumber: z.string().optional(),
  contractTitle: z.string().optional(),
  awardedOrganization: z.string().optional(),
  awardNotificationDate: z.string().optional(),

  // Contracting officer
  contractingOfficerName: z.string().optional(),
  contractingOfficerEmail: z.string().email().optional(),
  contractingOfficerAddress: z.string().optional(),

  // Requester information
  requesterName: z.string().optional(),
  requesterTitle: z.string().optional(),
  requesterEmail: z.string().email().optional(),
  requesterAddress: z.string().optional(),
  companyName: z.string().optional(),

  // Optional attached questions
  attachedQuestions: z.string().optional(),

  scheduledDate: z.string().datetime({ offset: true }).optional(),
  completedDate: z.string().datetime({ offset: true }).optional(),
  locationType: DebriefingLocationTypeSchema.optional(),
  location: z.string().optional(),
  meetingLink: z.string().url().optional(),
  attendees: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  findings: z.string().optional(),
  lessonsLearned: z.array(z.string()).optional(),
  actionItems: z.array(z.object({
    description: z.string(),
    assignee: z.string().optional(),
    dueDate: z.string().optional(),
    completed: z.boolean().optional(),
  })).optional(),
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
  debriefingId: z.string().min(1, 'Debriefing ID is required'),
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
export const calculateDebriefingDeadline = (notificationDate: Date): Date => {
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
};
