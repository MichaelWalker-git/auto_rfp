import { z } from 'zod';

/**
 * Debriefing Item - the complete debriefing record
 */
export const DebriefingItemSchema = z.object({
  debriefId: z.string().uuid(),
  projectId: z.string().min(1),
  orgId: z.string().min(1),
  opportunityId: z.string().min(1),

  // Solicitation / contract details
  solicitationNumber: z.string().min(1),
  contractTitle: z.string().min(1),
  awardedOrganization: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional(),
  ),
  awardNotificationDate: z.string().min(1),

  // Contracting officer
  contractingOfficerName: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional(),
  ),
  contractingOfficerEmail: z.string().email(),

  // Requester information
  requesterName: z.string().min(1),
  requesterTitle: z.string().min(1),
  requesterEmail: z.string().email(),
  requesterPhone: z.string().min(1),
  requesterAddress: z.string().min(1),
  companyName: z.string().min(1),

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
  contractTitle: z.string().min(1, 'Contract title is required'),
  awardedOrganization: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional(),
  ),
  awardNotificationDate: z.string().min(1, 'Award notification date is required'),

  // Contracting officer
  contractingOfficerName: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional(),
  ),
  contractingOfficerEmail: z.string().email('Valid contracting officer email is required'),

  // Requester information
  requesterName: z.string().min(1, 'Requester name is required'),
  requesterTitle: z.string().min(1, 'Requester title is required'),
  requesterEmail: z.string().email('Valid requester email is required'),
  requesterPhone: z.string().min(1, 'Requester phone is required'),
  requesterAddress: z.string().min(1, 'Requester address is required'),
  companyName: z.string().min(1, 'Company name is required'),

});

export type CreateDebriefingRequest = z.infer<typeof CreateDebriefingRequestSchema>;

/**
 * Auto-generated email subject — not a schema field, derived at send time
 */
export const generateDebriefingEmailSubject = (data: CreateDebriefingRequest): string =>
  `POST-AWARD DEBRIEFING REQUEST — Solicitation No. ${data.solicitationNumber}, ${data.contractTitle}`;

/**
 * Get Debriefing Response
 */
export const GetDebriefingResponseSchema = z.object({
  debriefings: z.array(DebriefingItemSchema),
});

export type GetDebriefingResponse = z.infer<typeof GetDebriefingResponseSchema>;

/**
 * Generate Debriefing Letter Request
 */
export const GenerateDebriefingLetterRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  orgId: z.string().min(1, 'Organization ID is required'),
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
  debriefingId: z.string().min(1, 'Debriefing ID is required'),
});

export type GenerateDebriefingLetterRequest = z.infer<typeof GenerateDebriefingLetterRequestSchema>;

/**
 * Generate Debriefing Letter Response
 */
export const GenerateDebriefingLetterResponseSchema = z.object({
  letter: z.string().min(1),
});

export type GenerateDebriefingLetterResponse = z.infer<typeof GenerateDebriefingLetterResponseSchema>;

/**
 * Update Debriefing Request DTO — all fields optional except identifiers
 */
export const UpdateDebriefingRequestSchema = z.object({
  // Required identifiers
  orgId: z.string().min(1, 'Organization ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
  debriefingId: z.string().min(1, 'Debriefing ID is required'),

  // Updatable fields (all optional)
  solicitationNumber: z.string().min(1).optional(),
  contractTitle: z.string().min(1).optional(),
  awardedOrganization: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional(),
  ),
  awardNotificationDate: z.string().min(1).optional(),
  contractingOfficerName: z.string().min(1).optional(),
  contractingOfficerEmail: z.string().email().optional(),
  requesterName: z.string().min(1).optional(),
  requesterTitle: z.string().min(1).optional(),
  requesterEmail: z.string().email().optional(),
  requesterPhone: z.string().min(1).optional(),
  requesterAddress: z.string().min(1).optional(),
  companyName: z.string().min(1).optional(),
});

export type UpdateDebriefingRequest = z.infer<typeof UpdateDebriefingRequestSchema>;
