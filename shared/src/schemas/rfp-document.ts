import { z } from 'zod';
import { ProposalDocumentSchema } from './proposal';

// ─── Document Types ───

export const RFP_DOCUMENT_TYPES = {
  TECHNICAL_PROPOSAL: 'Technical Proposal',
  EXECUTIVE_BRIEF: 'Executive Brief',
  EXECUTIVE_SUMMARY: 'Executive Summary',
  COST_PROPOSAL: 'Cost Proposal',
  PAST_PERFORMANCE: 'Past Performance',
  MANAGEMENT_APPROACH: 'Management Approach',
  MANAGEMENT_PROPOSAL: 'Management Proposal',
  PRICE_VOLUME: 'Price Volume',
  CERTIFICATIONS: 'Certifications',
  COMPLIANCE_MATRIX: 'Compliance Matrix',
  TEAMING_AGREEMENT: 'Teaming Agreement',
  NDA: 'NDA',
  CONTRACT: 'Contract',
  AMENDMENT: 'Amendment',
  CORRESPONDENCE: 'Correspondence',
  OTHER: 'Other',
} as const;

export const RFPDocumentTypeSchema = z.enum([
  'TECHNICAL_PROPOSAL',
  'EXECUTIVE_BRIEF',
  'EXECUTIVE_SUMMARY',
  'COST_PROPOSAL',
  'PAST_PERFORMANCE',
  'MANAGEMENT_APPROACH',
  'MANAGEMENT_PROPOSAL',
  'PRICE_VOLUME',
  'CERTIFICATIONS',
  'COMPLIANCE_MATRIX',
  'TEAMING_AGREEMENT',
  'NDA',
  'CONTRACT',
  'AMENDMENT',
  'CORRESPONDENCE',
  'OTHER',
]);

export type RFPDocumentType = z.infer<typeof RFPDocumentTypeSchema>;

// ─── Signature Status ───

export const SIGNATURE_STATUSES = {
  NOT_REQUIRED: 'Not Required',
  PENDING_SIGNATURE: 'Pending Signature',
  PARTIALLY_SIGNED: 'Partially Signed',
  FULLY_SIGNED: 'Fully Signed',
  REJECTED: 'Rejected',
} as const;

export const SignatureStatusSchema = z.enum([
  'NOT_REQUIRED',
  'PENDING_SIGNATURE',
  'PARTIALLY_SIGNED',
  'FULLY_SIGNED',
  'REJECTED',
]);

export type SignatureStatus = z.infer<typeof SignatureStatusSchema>;

// ─── Linear Sync Status ───

export const LINEAR_SYNC_STATUSES = {
  NOT_SYNCED: 'Not Synced',
  SYNCED: 'Synced',
  SYNC_FAILED: 'Sync Failed',
} as const;

export const LinearSyncStatusSchema = z.enum([
  'NOT_SYNCED',
  'SYNCED',
  'SYNC_FAILED',
]);

export type LinearSyncStatus = z.infer<typeof LinearSyncStatusSchema>;

// ─── Edit History ───

export const EditHistoryActionSchema = z.enum([
  'UPLOAD',
  'CONVERT',
  'CONTENT_EDIT',
  'FILE_REPLACE',
]);

export type EditHistoryAction = z.infer<typeof EditHistoryActionSchema>;

export const EditHistoryEntrySchema = z.object({
  editedBy: z.string(),
  editedByName: z.string().optional(),
  editedAt: z.string(),
  action: EditHistoryActionSchema,
  changeNote: z.string().optional(),
  version: z.number(),
});

export type EditHistoryEntry = z.infer<typeof EditHistoryEntrySchema>;

// ─── Signer ───

export const SignerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.enum(['PENDING', 'SIGNED', 'REJECTED']),
  signedAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type Signer = z.infer<typeof SignerSchema>;

// ─── Signature Details ───

export const SignatureDetailsSchema = z.object({
  signers: z.array(SignerSchema),
  signatureMethod: z.string().nullable().optional(),
  externalSignatureId: z.string().nullable().optional(),
  driveFileId: z.string().nullable().optional(),
  driveFileUrl: z.string().nullable().optional(),
  lastCheckedAt: z.string().nullable().optional(),
});

export type SignatureDetails = z.infer<typeof SignatureDetailsSchema>;

// ─── RFP Document Item ───

export const RFPDocumentItemSchema = z.object({
  documentId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  orgId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  documentType: RFPDocumentTypeSchema,
  mimeType: z.string(),
  fileSizeBytes: z.number(),
  originalFileName: z.string().nullable().optional(),
  fileKey: z.string().nullable(),
  version: z.number(),
  previousVersionId: z.string().nullable().optional(),
  signatureStatus: SignatureStatusSchema,
  signatureDetails: SignatureDetailsSchema.nullable().optional(),
  linearSyncStatus: LinearSyncStatusSchema,
  linearCommentId: z.string().nullable().optional(),
  lastSyncedAt: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdByName: z.string().optional(),
  updatedByName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Structured content for content-based documents (e.g., PROPOSAL) */
  content: ProposalDocumentSchema.nullable().optional(),
  /** Status for content-based documents */
  status: z.string().nullable().optional(),
  /** Title for content-based documents */
  title: z.string().nullable().optional(),
  /** Edit history for tracking modifications */
  editHistory: z.array(EditHistoryEntrySchema).nullable().optional(),
  /** Google Drive file ID when synced */
  googleDriveFileId: z.string().nullable().optional(),
  /** Google Drive URL when synced */
  googleDriveUrl: z.string().nullable().optional(),
});

export type RFPDocumentItem = z.infer<typeof RFPDocumentItemSchema>;

// ─── Create DTO ───

export const CreateRFPDocumentDTOSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  documentType: RFPDocumentTypeSchema,
  mimeType: z.string().optional(),
  fileSizeBytes: z.number().optional(),
  originalFileName: z.string().nullable().optional(),
  /** For content-based documents */
  content: z.record(z.any()).nullable().optional(),
  status: z.string().optional(),
  title: z.string().nullable().optional(),
});

export type CreateRFPDocumentDTO = z.infer<typeof CreateRFPDocumentDTOSchema>;

// ─── Update DTO ───

export const UpdateRFPDocumentDTOSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  documentType: RFPDocumentTypeSchema.optional(),
  content: z.record(z.any()).nullable().optional(),
  status: z.string().optional(),
  title: z.string().nullable().optional(),
});

export type UpdateRFPDocumentDTO = z.infer<typeof UpdateRFPDocumentDTOSchema>;

// ─── RFP Document Export Format ───

export const RFPExportFormatSchema = z.enum(['docx', 'pdf', 'html', 'txt', 'pptx', 'md']);

export type RFPExportFormat = z.infer<typeof RFPExportFormatSchema>;

export const RFP_EXPORT_FORMAT_LABELS: Record<RFPExportFormat, string> = {
  docx: 'Word Document (.docx)',
  pdf: 'PDF Document (.pdf)',
  html: 'HTML (.html)',
  txt: 'Plain Text (.txt)',
  pptx: 'PowerPoint (.pptx)',
  md: 'Markdown (.md)',
};

export const RFP_EXPORT_FORMAT_EXTENSIONS: Record<RFPExportFormat, string> = {
  docx: '.docx',
  pdf: '.pdf',
  html: '.html',
  txt: '.txt',
  pptx: '.pptx',
  md: '.md',
};