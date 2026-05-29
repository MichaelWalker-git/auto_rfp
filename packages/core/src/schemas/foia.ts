import { z } from 'zod';

/**
 * FOIA Document Types that can be requested
 */
export const FOIADocumentTypeSchema = z.enum([
  'SSEB_REPORT',
  'SSDD',
  'TECHNICAL_EVAL',
  'PRICE_ANALYSIS',
  'PAST_PERFORMANCE_EVAL',
  'PROPOSAL_ABSTRACT',
  'DEBRIEFING_NOTES',
  'WINNING_PROPOSAL_TECH',
  'CONSENSUS_WORKSHEETS',
  'RESPONSIBILITY_DETERMINATION',
  'CORRESPONDENCE',
  'AWARD_NOTICE',
  'OTHER',
]);

export type FOIADocumentType = z.infer<typeof FOIADocumentTypeSchema>;

/**
 * FOIA Document Types constant for use in components
 */
export const FOIA_DOCUMENT_TYPES = FOIADocumentTypeSchema.options;

/**
 * Human-readable descriptions for FOIA document types
 */
export const FOIA_DOCUMENT_DESCRIPTIONS: Record<FOIADocumentType, string> = {
  SSEB_REPORT: 'The complete Source Selection Evaluation Board (SSEB) report, including all technical and cost/price evaluations',
  SSDD: 'The Source Selection Decision Document (SSDD)',
  TECHNICAL_EVAL: 'Technical evaluation reports and findings',
  PRICE_ANALYSIS: 'Price/cost analysis documentation for all offerors',
  PAST_PERFORMANCE_EVAL: 'Past performance evaluation reports for all offerors',
  WINNING_PROPOSAL_TECH: "The winning contractor's technical proposal (with proprietary information redacted as required)",
  CONSENSUS_WORKSHEETS: 'Consensus evaluation worksheets and scoring documents',
  RESPONSIBILITY_DETERMINATION: 'The determination of contractor responsibility',
  CORRESPONDENCE: 'All correspondence between the contracting officer and the winning contractor during the evaluation period',
  PROPOSAL_ABSTRACT: 'Proposal Abstract or Executive Summary',
  DEBRIEFING_NOTES: 'Debriefing Notes or Documentation',
  AWARD_NOTICE: 'Award Notice and Supporting Documentation',
  OTHER: 'Other Relevant Documentation',
};

/**
 * FOIA Request Status
 */
export const FOIAStatusSchema = z.enum([
  'DRAFT',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'IN_PROCESSING',
  'RESPONSE_RECEIVED',
  'APPEAL_FILED',
  'CLOSED',
]);

export type FOIAStatus = z.infer<typeof FOIAStatusSchema>;

/**
 * FOIA Requester Category
 */
export const RequesterCategorySchema = z.enum([
  'COMMERCIAL',
  'EDUCATIONAL',
  'NEWS_MEDIA',
  'OTHER',
]);

export type RequesterCategory = z.infer<typeof RequesterCategorySchema>;

/**
 * FOIA Submission Method
 */
export const FOIASubmissionMethodSchema = z.enum([
  'AUTO_EMAIL',
  'MANUAL_EMAIL',
  'WEB_PORTAL',
  'MAIL',
  'FAX',
]);

export type FOIASubmissionMethod = z.infer<typeof FOIASubmissionMethodSchema>;

/**
 * FOIA Response Status
 */
export const FOIAResponseStatusSchema = z.enum([
  'FULL_GRANT',
  'PARTIAL_GRANT',
  'DENIAL',
  'NO_RECORDS',
  'REFERRED',
]);

export type FOIAResponseStatus = z.infer<typeof FOIAResponseStatusSchema>;

/**
 * FOIA Address
 */
export const FOIAAddressSchema = z.object({
  street1: z.string().min(1),
  street2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  zip: z.string().min(5).max(10),
});

export type FOIAAddress = z.infer<typeof FOIAAddressSchema>;

/**
 * S3 Document Reference
 */
export const S3ReferenceSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  filename: z.string().min(1),
  uploadedAt: z.string().datetime({ offset: true }),
});

export type S3Reference = z.infer<typeof S3ReferenceSchema>;

/**
 * FOIA Status Change History Entry
 */
export const FOIAStatusChangeSchema = z.object({
  status: FOIAStatusSchema,
  changedAt: z.string().datetime({ offset: true }),
  changedBy: z.string().min(1),
  notes: z.string().optional(),
});

export type FOIAStatusChange = z.infer<typeof FOIAStatusChangeSchema>;

/**
 * FOIA Agency Info (from FOIA.gov API)
 */
export const FOIAAgencyInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  abbreviation: z.string().min(1),
  parentAgencyId: z.string().optional(),
  parentAgencyName: z.string().optional(),
  foiaOfficeEmail: z.string().email().optional(),
  foiaOfficeAddress: FOIAAddressSchema.optional(),
  webPortalUrl: z.string().url().optional(),
  faxNumber: z.string().optional(),
});

export type FOIAAgencyInfo = z.infer<typeof FOIAAgencyInfoSchema>;

/**
 * FOIA Request Item - the complete FOIA request record
 */
export const FOIARequestItemSchema = z.object({
  foiaId: z.string().uuid(),
  id: z.string().min(1),
  projectId: z.string().min(1),
  orgId: z.string().min(1),

  // Status
  status: FOIAStatusSchema,

  // Agency information
  agencyId: z.string().min(1),
  agencyName: z.string().min(1),
  agencyFOIAEmail: z.string().email().optional(),
  agencyFOIAAddress: z.string().optional(),
  agencyAbbreviation: z.string().min(1),
  foiaOfficeEmail: z.string().email().optional(),
  foiaOfficeAddress: FOIAAddressSchema.optional(),
  portalUrl: z.string().url().optional(),

  // Request details
  solicitationNumber: z.string().min(1),
  contractTitle: z.string().min(1),
  contractNumber: z.string().optional(),
  requestedDocuments: z.array(FOIADocumentTypeSchema).min(1),
  customDocumentRequests: z.array(z.string().min(1)).optional(),
  requesterCategory: RequesterCategorySchema,
  feeLimit: z.number().nonnegative(),
  requestFeeWaiver: z.boolean(),
  feeWaiverJustification: z.string().optional(),

  // Requester information
  requesterName: z.string().min(1),
  requesterEmail: z.string().email(),
  requesterPhone: z.string().optional(),
  requesterAddress: z.string().optional(),
  // Status tracking
  statusHistory: z.array(FOIAStatusChangeSchema),
  // Tracking
  expectedResponseDate: z.string().datetime({ offset: true }).optional(),
  submittedDate: z.string().datetime({ offset: true }).optional(),
  responseDate: z.string().datetime({ offset: true }).optional(),
  responseNotes: z.string().optional(),
  receivedDocuments: z.array(FOIADocumentTypeSchema).optional(),
  // Dates and deadlines
  submittedAt: z.string().datetime({ offset: true }).optional(),
  responseDeadline: z.string().datetime({ offset: true }).optional(),
  extensionDeadline: z.string().datetime({ offset: true }).optional(),
  responseReceivedAt: z.string().datetime({ offset: true }).optional(),

  // Submission details
  submissionMethod: FOIASubmissionMethodSchema.optional(),
  autoSubmitAttempted: z.boolean(),
  autoSubmitSuccess: z.boolean().optional(),
  autoSubmitError: z.string().optional(),
  trackingNumber: z.string().optional(),
  appealDeadline: z.string().datetime({ offset: true }).optional(),
  appealDate: z.string().datetime({ offset: true }).optional(),

  // Response
  responseStatus: FOIAResponseStatusSchema.optional(),
  responseDocuments: z.array(S3ReferenceSchema).optional(),
  exemptionsCited: z.array(z.string().min(1)).optional(),

  // Generated letter
  generatedLetterS3Key: z.string().min(1),
  generatedLetterVersion: z.number().int().positive(),

  // Metadata
  requestedBy: z.string().min(1),
  notes: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  createdBy: z.string().min(1),
});

export type FOIARequestItem = z.infer<typeof FOIARequestItemSchema>;

/**
 * Create FOIA Request DTO
 */
export const CreateFOIARequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  orgId: z.string().min(1, 'Organization ID is required'),
  agencyName: z.string().min(1, 'Agency name is required'),
  agencyFOIAEmail: z.string().email().optional(),
  agencyFOIAAddress: z.string().optional(),
  solicitationNumber: z.string().min(1, 'Solicitation number is required'),
  contractNumber: z.string().optional(),
  requestedDocuments: z.array(FOIADocumentTypeSchema).min(1, 'At least one document type is required'),
  requesterName: z.string().min(1, 'Requester name is required'),
  requesterEmail: z.string().email('Valid email is required'),
  requesterPhone: z.string().optional(),
  requesterAddress: z.string().optional(),
  notes: z.string().optional(),
  customDocumentRequests: z.array(z.string().min(1)).optional(),
  requesterCategory: RequesterCategorySchema.default('OTHER'),
  feeLimit: z.number().nonnegative().default(50),
  requestFeeWaiver: z.boolean().default(false),
  feeWaiverJustification: z.string().optional(),
});

export type CreateFOIARequest = z.infer<typeof CreateFOIARequestSchema>;

/**
 * Update FOIA Request DTO
 */
export const UpdateFOIARequestSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  foiaRequestId: z.string().min(1, 'FOIA Request ID is required'),
  status: FOIAStatusSchema.optional(),
  submittedDate: z.string().datetime({ offset: true }).optional(),
  responseDate: z.string().datetime({ offset: true }).optional(),
  responseNotes: z.string().optional(),
  receivedDocuments: z.array(FOIADocumentTypeSchema).optional(),
  trackingNumber: z.string().optional(),
  appealDeadline: z.string().datetime({ offset: true }).optional(),
  appealDate: z.string().datetime({ offset: true }).optional(),
  notes: z.string().optional(),
});

export type UpdateFOIARequest = z.infer<typeof UpdateFOIARequestSchema>;

/**
 * Update FOIA Status DTO (legacy - use UpdateFOIARequestSchema instead)
 */
export const UpdateFOIAStatusSchema = z.object({
  status: FOIAStatusSchema,
  trackingNumber: z.string().optional(),
  notes: z.string().optional(),
});

export type UpdateFOIAStatus = z.infer<typeof UpdateFOIAStatusSchema>;

/**
 * Submit FOIA Request DTO
 */
export const SubmitFOIARequestSchema = z.object({
  method: z.enum(['AUTO_EMAIL', 'MANUAL']),
});

export type SubmitFOIARequest = z.infer<typeof SubmitFOIARequestSchema>;

/**
 * Submit FOIA Response
 */
export const SubmitFOIAResponseSchema = z.object({
  success: z.boolean(),
  autoSubmitted: z.boolean().optional(),
  downloadUrl: z.string().url().optional(),
  error: z.string().optional(),
});

export type SubmitFOIAResponse = z.infer<typeof SubmitFOIAResponseSchema>;

/**
 * Generate FOIA Appeal Request DTO
 */
export const GenerateFOIAAppealSchema = z.object({
  foiaId: z.string().uuid(),
  appealReason: z.string().min(10, 'Appeal reason must be at least 10 characters'),
});

export type GenerateFOIAAppeal = z.infer<typeof GenerateFOIAAppealSchema>;

/**
 * Get FOIA Requests Query (by project)
 */
export const GetFOIARequestsQuerySchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
});

export type GetFOIARequestsQuery = z.infer<typeof GetFOIARequestsQuerySchema>;

/**
 * List FOIA Requests Query (with pagination)
 */
export const ListFOIARequestsQuerySchema = z.object({
  orgId: z.string().min(1),
  status: FOIAStatusSchema.optional(),
  limit: z.number().int().positive().max(100).default(20),
  nextToken: z.string().optional(),
});

export type ListFOIARequestsQuery = z.infer<typeof ListFOIARequestsQuerySchema>;

/**
 * Calculate FOIA response deadline (20 business days from submission)
 */
export function calculateFOIADeadline(submissionDate: Date): Date {
  const deadline = new Date(submissionDate);
  let businessDays = 0;

  while (businessDays < 20) {
    deadline.setDate(deadline.getDate() + 1);
    const dayOfWeek = deadline.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
  }

  return deadline;
}

/**
 * Calculate FOIA extension deadline (additional 10 business days)
 */
export function calculateFOIAExtensionDeadline(originalDeadline: Date): Date {
  const deadline = new Date(originalDeadline);
  let businessDays = 0;

  while (businessDays < 10) {
    deadline.setDate(deadline.getDate() + 1);
    const dayOfWeek = deadline.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
  }

  return deadline;
}
