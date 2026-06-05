import { z } from 'zod';

/**
 * Jurisdiction of the contract / records request.
 * - FEDERAL: federal contract — eligible for a debrief and a federal FOIA request (5 U.S.C. § 552).
 * - STATE: state/local contract — no debrief; records are obtained under the state's public records law.
 */
export const JurisdictionSchema = z.enum(['FEDERAL', 'STATE']);

export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

/**
 * US states (plus D.C.) and the name of the public-records law that is the
 * state-level equivalent of the federal Freedom of Information Act.
 *
 * Used to label state records requests and to cite the applicable law in the
 * generated request letter. Keyed by full state name.
 */
export const STATE_RECORDS_LAWS = {
  Alabama: 'Alabama Public Records Law',
  Alaska: 'Alaska Public Records Act',
  Arizona: 'Arizona Public Records Law',
  Arkansas: 'Arkansas Freedom of Information Act',
  California: 'California Public Records Act (CPRA)',
  Colorado: 'Colorado Open Records Act',
  Connecticut: 'Connecticut Freedom of Information Act',
  Delaware: 'Delaware Freedom of Information Act',
  Florida: 'Florida Sunshine Law',
  Georgia: 'Georgia Open Records Act',
  Hawaii: 'Hawaii Uniform Information Practices Act',
  Idaho: 'Idaho Public Records Act',
  Illinois: 'Illinois Freedom of Information Act',
  Indiana: 'Indiana Access to Public Records Act',
  Iowa: 'Iowa Open Records Law',
  Kansas: 'Kansas Open Records Act',
  Kentucky: 'Kentucky Open Records Act',
  Louisiana: 'Louisiana Public Records Act',
  Maine: 'Maine Freedom of Access Act',
  Maryland: 'Maryland Public Information Act',
  Massachusetts: 'Massachusetts Public Records Law',
  Michigan: 'Michigan Freedom of Information Act',
  Minnesota: 'Minnesota Government Data Practices Act',
  Mississippi: 'Mississippi Public Records Act',
  Missouri: 'Missouri Sunshine Law',
  Montana: 'Montana Public Records Act',
  Nebraska: 'Nebraska Public Records Law',
  Nevada: 'Nevada Public Records Act',
  'New Hampshire': 'New Hampshire Right to Know Law',
  'New Jersey': 'New Jersey Open Public Records Act (OPRA)',
  'New Mexico': 'New Mexico Inspection of Public Records Act (IPRA)',
  'New York': 'New York Freedom of Information Law (FOIL)',
  'North Carolina': 'North Carolina Public Records Law',
  'North Dakota': 'North Dakota Open Records Statute',
  Ohio: 'Ohio Public Records and Open Meetings Law ("Sunshine Law")',
  Oklahoma: 'Oklahoma Open Records Act',
  Oregon: 'Oregon Public Records Law',
  Pennsylvania: 'Pennsylvania Right to Know Law',
  'Rhode Island': 'Rhode Island Access to Public Records Act (APRA)',
  'South Carolina': 'South Carolina Freedom of Information Act',
  'South Dakota': 'South Dakota Open Records Law',
  Tennessee: 'Tennessee Public Records Act',
  Texas: 'Texas Public Information Act (PIA)',
  Utah: 'Utah Government Records Access and Management Act (GRAMA)',
  Vermont: 'Vermont Public Records Law',
  Virginia: 'Virginia Freedom of Information Act',
  Washington: 'Washington Public Records Act',
  'West Virginia': 'West Virginia Freedom of Information Act',
  Wisconsin: 'Wisconsin Open Records Law',
  Wyoming: 'Wyoming Public Records Act',
  'Washington, D.C.': 'District of Columbia Freedom of Information Act',
} as const satisfies Record<string, string>;

/**
 * State name as used by {@link STATE_RECORDS_LAWS}.
 */
export const StateNameSchema = z.enum(
  Object.keys(STATE_RECORDS_LAWS) as [keyof typeof STATE_RECORDS_LAWS, ...Array<keyof typeof STATE_RECORDS_LAWS>],
);

export type StateName = z.infer<typeof StateNameSchema>;

/**
 * Ordered list of state names for use in select inputs.
 */
export const STATE_NAMES = StateNameSchema.options;

/**
 * Resolve the public-records law name for a given state.
 */
export const getStateRecordsLaw = (state: string): string | undefined =>
  (STATE_RECORDS_LAWS as Record<string, string>)[state];

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
  feeLimit: z.preprocess(
    (val) => (typeof val === 'number' && isNaN(val) ? undefined : val),
    z.number().nonnegative().default(0),
  ),
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

/**
 * Delete FOIA Request DTO
 */
export const DeleteFOIARequestSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
  foiaRequestId: z.string().min(1, 'FOIA Request ID is required'),
});

export type DeleteFOIARequest = z.infer<typeof DeleteFOIARequestSchema>;
