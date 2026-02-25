import { z } from 'zod';

// ─── RFP Document Content ─────────────────────────────────────────────────────

/**
 * The structured content stored inside an RFPDocumentItem.
 * Documents are authored and stored as raw HTML in the `content` field.
 * Metadata fields (`title`, `customerName`, etc.) are extracted
 * for search and display purposes.
 */
export const RFPDocumentContentSchema = z.object({
  title: z.string(),
  customerName: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  outlineSummary: z.string().nullable().optional(),
  /** Raw HTML content — the canonical editable representation of the document. */
  content: z.string().nullable().optional(),
  /**
   * Alias for `content` — the AI model returns this field name.
   * Normalized to `content` after parsing via the `transform` step in the worker.
   */
  htmlContent: z.string().nullable().optional(),
});

export type RFPDocumentContent = z.infer<typeof RFPDocumentContentSchema>;

// ─── Document Types ───

/**
 * All RFP proposal document types.
 * Ordered to reflect the natural sequence of a winning proposal response.
 *
 * Core proposal sections (increase win rate):
 *  1. COVER_LETTER                  — Personalized transmittal letter to the evaluator
 *  2. EXECUTIVE_SUMMARY             — Most-read section; client-focused value proposition
 *  3. UNDERSTANDING_OF_REQUIREMENTS — Demonstrates comprehension of client needs
 *  4. TECHNICAL_PROPOSAL            — Detailed solution mapped to each requirement
 *  5. PROJECT_PLAN                  — Phased timeline, milestones, and deliverables
 *  6. TEAM_QUALIFICATIONS           — Key personnel bios and org chart
 *  7. PAST_PERFORMANCE              — Relevant past projects with quantified results
 *  8. COST_PROPOSAL                 — Detailed pricing with justification
 *  9. MANAGEMENT_APPROACH           — Program management, QA, and communication plan
 * 10. RISK_MANAGEMENT               — Identified risks with mitigation strategies
 * 11. COMPLIANCE_MATRIX             — Requirement traceability table
 * 12. CERTIFICATIONS                — Representations, certifications, and compliance
 * 13. APPENDICES                    — Supporting materials, resumes, diagrams
 *
 * Supporting / administrative documents:
 *  - EXECUTIVE_BRIEF                — Internal opportunity analysis (bid/no-bid)
 *  - MANAGEMENT_PROPOSAL            — Standalone management volume
 *  - PRICE_VOLUME                   — Standalone price/cost volume
 *  - QUALITY_MANAGEMENT             — Quality assurance plan
 *  - TEAMING_AGREEMENT              — Teaming / subcontractor agreements
 *  - NDA                            — Non-disclosure agreement
 *  - CONTRACT                       — Contract document
 *  - AMENDMENT                      — Contract amendment
 *  - CORRESPONDENCE                 — General correspondence
 *  - OTHER                          — Miscellaneous
 */
export const RFP_DOCUMENT_TYPES = {
  // ── Core Proposal Sections (Win-Optimized Order) ──
  COVER_LETTER: 'Cover Letter',
  EXECUTIVE_SUMMARY: 'Executive Summary',
  UNDERSTANDING_OF_REQUIREMENTS: 'Understanding of Requirements',
  TECHNICAL_PROPOSAL: 'Technical Proposal',
  PROJECT_PLAN: 'Project Plan',
  TEAM_QUALIFICATIONS: 'Team Qualifications',
  PAST_PERFORMANCE: 'Past Performance',
  COST_PROPOSAL: 'Cost Proposal',
  MANAGEMENT_APPROACH: 'Management Approach',
  RISK_MANAGEMENT: 'Risk Management',
  COMPLIANCE_MATRIX: 'Compliance Matrix',
  CERTIFICATIONS: 'Certifications',
  APPENDICES: 'Appendices',
  // ── Supporting / Administrative ──
  EXECUTIVE_BRIEF: 'Executive Brief',
  MANAGEMENT_PROPOSAL: 'Management Proposal',
  PRICE_VOLUME: 'Price Volume',
  QUALITY_MANAGEMENT: 'Quality Management Plan',
  TEAMING_AGREEMENT: 'Teaming Agreement',
  NDA: 'NDA',
  CONTRACT: 'Contract',
  AMENDMENT: 'Amendment',
  CORRESPONDENCE: 'Correspondence',
  OTHER: 'Other',
} as const;

/**
 * Short descriptions for each document type — used in UI tooltips and AI prompts.
 */
export const RFP_DOCUMENT_TYPE_DESCRIPTIONS: Record<keyof typeof RFP_DOCUMENT_TYPES, string> = {
  COVER_LETTER: 'Personalized transmittal letter addressed to the evaluator, signed by a senior executive. States intent to respond and highlights the single most compelling differentiator.',
  EXECUTIVE_SUMMARY: 'The most-read section. A concise 2–4 page overview of your solution, key differentiators, relevant experience, and value proposition — written from the customer\'s perspective.',
  UNDERSTANDING_OF_REQUIREMENTS: 'Demonstrates that you fully understand the client\'s mission, challenges, and objectives. Restates the problem in your own words to build evaluator trust before presenting your solution.',
  TECHNICAL_PROPOSAL: 'Detailed description of how you will solve the problem. Maps your solution, methodology, tools, and technologies directly to each stated requirement using the Problem → Solution → Benefit pattern.',
  PROJECT_PLAN: 'Phased project timeline with clear milestones, deliverables, and dependencies. Includes a Gantt chart or milestone table with realistic schedules and risk buffers.',
  TEAM_QUALIFICATIONS: 'Bios of key personnel who will actually perform the work. Includes relevant experience, certifications, and an org chart showing roles and responsibilities.',
  PAST_PERFORMANCE: '3–5 relevant past projects with quantified outcomes (metrics, CPARS ratings, awards). Explicitly maps each past project to current requirements using the STAR format.',
  COST_PROPOSAL: 'Detailed cost breakdown by labor category, ODCs, and period of performance. Justifies pricing with basis-of-estimate, rate justification, and cost realism narrative.',
  MANAGEMENT_APPROACH: 'Program management methodology, governance structure, communication plan, QA/QC processes, and escalation procedures. Shows how you will deliver on time and on budget.',
  RISK_MANAGEMENT: 'Identifies top project risks with likelihood, impact, and specific mitigation strategies. Demonstrates proactive thinking and reduces perceived risk for the evaluator.',
  COMPLIANCE_MATRIX: 'A table mapping every RFP requirement (Section L/M) to the exact location in your proposal. Helps evaluators give you full marks and proves nothing was missed.',
  CERTIFICATIONS: 'Representations, certifications, and compliance statements required by the solicitation. Includes business size/type, FAR/DFARS compliance, technical certifications, and security clearances.',
  APPENDICES: 'Supporting materials including resumes, certifications, letters of support, technical diagrams, architecture drawings, and sample deliverables.',
  EXECUTIVE_BRIEF: 'Internal opportunity analysis document covering bid/no-bid scoring, risk assessment, requirements analysis, and strategic alignment.',
  MANAGEMENT_PROPOSAL: 'Standalone management volume covering organizational structure, key personnel, program management approach, and quality assurance.',
  PRICE_VOLUME: 'Standalone price/cost volume with detailed CLIN pricing, basis of estimate, labor rates, and cost narrative.',
  QUALITY_MANAGEMENT: 'Quality Assurance and Quality Control plan detailing processes, checkpoints, metrics, and continuous improvement methodology.',
  TEAMING_AGREEMENT: 'Formal agreement between prime contractor and subcontractors defining roles, responsibilities, and workshare.',
  NDA: 'Non-disclosure agreement protecting proprietary information shared during the proposal process.',
  CONTRACT: 'Executed contract document.',
  AMENDMENT: 'Contract or solicitation amendment.',
  CORRESPONDENCE: 'General correspondence related to the opportunity.',
  OTHER: 'Miscellaneous document not covered by other categories.',
};

export const RFPDocumentTypeSchema = z.enum([
  // Core proposal sections
  'COVER_LETTER',
  'EXECUTIVE_SUMMARY',
  'UNDERSTANDING_OF_REQUIREMENTS',
  'TECHNICAL_PROPOSAL',
  'PROJECT_PLAN',
  'TEAM_QUALIFICATIONS',
  'PAST_PERFORMANCE',
  'COST_PROPOSAL',
  'MANAGEMENT_APPROACH',
  'RISK_MANAGEMENT',
  'COMPLIANCE_MATRIX',
  'CERTIFICATIONS',
  'APPENDICES',
  // Supporting / administrative
  'EXECUTIVE_BRIEF',
  'MANAGEMENT_PROPOSAL',
  'PRICE_VOLUME',
  'QUALITY_MANAGEMENT',
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
  /** Structured content for content-based documents. Raw HTML stored in content.content field. */
  content: RFPDocumentContentSchema.nullable().optional(),
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
  /**
   * S3 key for the generated/edited HTML content.
   * When present, the HTML body lives in S3 and this field is the key.
   * The `content.content` field will be absent (stripped to save DynamoDB space).
   * Legacy documents may still have HTML inline in `content.content`.
   */
  htmlContentKey: z.string().nullable().optional(),
  /** Generation error message when status is FAILED */
  generationError: z.string().nullable().optional(),
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