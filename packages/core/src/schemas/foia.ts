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
  'SOLICITATION_RECORDS',
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
  SSEB_REPORT: 'Source Selection Evaluation Board (SSEB) report',
  SSDD: 'Source Selection Decision Document (SSDD)',
  TECHNICAL_EVAL: 'Technical evaluation reports and findings',
  PRICE_ANALYSIS: 'Price/cost analysis documentation',
  PAST_PERFORMANCE_EVAL: 'Past performance evaluation reports',
  WINNING_PROPOSAL_TECH: "Winning contractor's technical proposal (redacted as appropriate)",
  CONSENSUS_WORKSHEETS: 'Consensus evaluation worksheets and scoring documents',
  RESPONSIBILITY_DETERMINATION: 'Determination of contractor responsibility',
  CORRESPONDENCE: 'Correspondence between the contracting officer and the winning contractor during the evaluation period',
  PROPOSAL_ABSTRACT: 'Proposal abstract or executive summary of winning proposal',
  DEBRIEFING_NOTES: 'Debriefing notes or documentation for winning proposal',
  AWARD_NOTICE: 'Award notice and supporting documentation',
  SOLICITATION_RECORDS: 'Solicitation records including amendments and pre-solicitation documents',
};

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
  opportunityId: z.string().min(1),

  // Agency information
  agencyName: z.string().min(1),
  agencyFOIAEmail: z.string().email(),
  agencyFOIAAddress: z.string().min(1),

  // Request details
  solicitationNumber: z.string().min(1),
  contractTitle: z.string().min(1),
  requestedDocuments: z.array(FOIADocumentTypeSchema).min(1),
  customDocumentRequests: z.array(z.string().min(1)).default([]),
  feeLimit: z.number().nonnegative().default(0),

  // Company / awardee information
  companyName: z.string().min(1),
  awardeeName: z.string().optional(),
  awardDate: z.string().min(1),

  // Requester information
  requesterName: z.string().min(1),
  requesterTitle: z.string().min(1),
  requesterEmail: z.string().email(),
  requesterPhone: z.string().min(1),
  requesterAddress: z.string().min(1),

  // Metadata
  requestedBy: z.string().min(1),
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
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
  agencyName: z.string().min(1, 'Agency name is required'),
  agencyFOIAEmail: z.string().email('Valid agency FOIA email is required'),
  agencyFOIAAddress: z.string().min(1, 'Agency FOIA address is required'),
  solicitationNumber: z.string().min(1, 'Solicitation number is required'),
  contractTitle: z.string().min(1, 'Contract title is required'),
  requestedDocuments: z.array(FOIADocumentTypeSchema).min(1, 'At least one document type is required'),
  requesterName: z.string().min(1, 'Requester name is required'),
  requesterTitle: z.string().min(1, 'Requester title is required'),
  requesterEmail: z.string().email('Valid email is required'),
  requesterPhone: z.string().min(1, 'Requester phone is required'),
  requesterAddress: z.string().min(1, 'Requester address is required'),
  customDocumentRequests: z.array(z.string().min(1)).default([]),
  companyName: z.string().min(1, 'Company name is required'),
  awardeeName: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional(),
  ),
  awardDate: z.string().min(1, 'Award date is required'),
  feeLimit: z.number().nonnegative().default(0),
});

export type CreateFOIARequest = z.infer<typeof CreateFOIARequestSchema>;

/**
 * Get FOIA Requests Query (by project)
 */
export const GetFOIARequestsQuerySchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
});

export type GetFOIARequestsQuery = z.infer<typeof GetFOIARequestsQuerySchema>;

/**
 * Update FOIA Request DTO — all fields optional except identifiers
 */
export const UpdateFOIARequestSchema = z.object({
  // Required identifiers
  orgId: z.string().min(1, 'Organization ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
  foiaRequestId: z.string().min(1, 'FOIA Request ID is required'),

  // Updatable fields (all optional)
  agencyName: z.string().min(1).optional(),
  agencyFOIAEmail: z.string().email().optional(),
  agencyFOIAAddress: z.string().min(1).optional(),
  solicitationNumber: z.string().min(1).optional(),
  contractTitle: z.string().min(1).optional(),
  requestedDocuments: z.array(FOIADocumentTypeSchema).min(1).optional(),
  requesterName: z.string().min(1).optional(),
  requesterTitle: z.string().min(1).optional(),
  requesterEmail: z.string().email().optional(),
  requesterPhone: z.string().min(1).optional(),
  requesterAddress: z.string().min(1).optional(),
  customDocumentRequests: z.array(z.string().min(1)).optional(),
  companyName: z.string().min(1).optional(),
  awardeeName: z.string().optional(),
  awardDate: z.string().min(1).optional(),
  feeLimit: z.number().nonnegative().optional(),
});

export type UpdateFOIARequest = z.infer<typeof UpdateFOIARequestSchema>;
