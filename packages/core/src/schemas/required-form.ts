import { z } from 'zod';
import {
  NotaryStatusSchema,
  NotaryRequirementSchema,
  NotaryClassificationSourceSchema,
} from './notary';

// ─── Form Field Status ───

export const FormFieldStatusSchema = z.enum([
  'AUTO_FILLED',
  'MANUAL_REQUIRED',
  'LOW_CONFIDENCE',
  'EMPTY',
]);

export type FormFieldStatus = z.infer<typeof FormFieldStatusSchema>;

// ─── Form Type ───

export const FormTypeSchema = z.enum([
  'PDF_FILLABLE',
  'PDF_SCANNED',
  'XLSX_MATRIX',
  'XLSX_FORM',
  'DOCX_FORM',
  'CONTRACT_TEMPLATE',
]);

export type FormType = z.infer<typeof FormTypeSchema>;

// ─── Form Processing Status ───

export const FormProcessingStatusSchema = z.enum([
  'NEW',
  'IN_PROGRESS',
  'READY',
  'DONE',
  'FAILED',
]);

export type FormProcessingStatus = z.infer<typeof FormProcessingStatusSchema>;

// ─── Field Mark (checkbox / circle) ───

export const FieldMarkTypeSchema = z.enum(['TEXT', 'CHECKBOX', 'CIRCLE']);
export type FieldMarkType = z.infer<typeof FieldMarkTypeSchema>;

// Geometry for stamped marks on PDFs. cx/cy/radius are normalized to 0..1 of the page.
export const FieldMarkGeometrySchema = z.object({
  cx: z.number(),
  cy: z.number(),
  radius: z.number().min(0).max(0.5),
});
export type FieldMarkGeometry = z.infer<typeof FieldMarkGeometrySchema>;

// Which column of an XLSX response matrix a field belongs to.
export const MatrixColumnSchema = z.enum([
  'FULLY_MEETS',
  'PARTIALLY_MEETS',
  'CANNOT_MEET',
  'COMMENTS',
  'OTHER',
]);
export type MatrixColumn = z.infer<typeof MatrixColumnSchema>;

// ─── DOCX Fill Strategy (form-level) ───

// How a DOCX form is filled. BOTH strategies write into the ORIGINAL document
// (formatting preserved); neither generates a separate document. The value is
// informational — it drives detection routing and UI messaging, not a different
// output format. Null on non-DOCX forms and legacy records.
//
// - IN_PLACE:   the doc has real fillable content controls (`<w:sdt>`) or legacy
//               FORMTEXT form fields. Values are written into those controls.
// - TEXT_TOKEN: a prose/styled-text doc. Fillable spots are inline placeholders
//               (`[INSERT SUPPLIER NAME]` → TEXT_TOKEN anchor) and label blanks
//               (`Name:`/`Title:`/`Date:` → TEXT_LABEL anchor, per-occurrence).
//               Values are written into those spots in place.
//
// Only fields WITH a value are written; empty fields are skipped, so the spot
// stays exactly as in the original ("filled stays filled, empty stays empty").
// A label the LLM surfaced but couldn't anchor is left as-is and flagged manual.
// The original is never corrupted.
export const DocxFillStrategySchema = z.enum(['IN_PLACE', 'TEXT_TOKEN']);
export type DocxFillStrategy = z.infer<typeof DocxFillStrategySchema>;

// ─── DOCX Anchor (field-level) ───

// Anchors a field back to a location in the source document.xml so the filler
// can write the value into the ORIGINAL document without re-parsing. Null for
// fields with no fillable spot (left blank, flagged manual) and all non-DOCX
// forms — mirrors how XLSX fields carry `cellReference`.
export const DocxAnchorSchema = z.object({
  kind: z.enum(['SDT', 'LEGACY_FORMFIELD', 'TEXT_TOKEN', 'TEXT_LABEL', 'TABLE_CELL_LABEL', 'UNDERSCORE_BLANK', 'CHECKBOX']),
  // SDT:              the <w:id w:val> of the content control (stable, unique).
  // LEGACY_FORMFIELD: the FORMTEXT bookmark name.
  // TEXT_TOKEN:       the literal placeholder text to find-and-replace in a run,
  //                   e.g. "[INSERT SUPPLIER NAME]".
  // TEXT_LABEL:       a label with a blank on the SAME line, e.g. "Name:   ".
  //                   The value is written right after the label in its run.
  // TABLE_CELL_LABEL: a label in one table cell whose answer belongs in the
  //                   NEXT cell, e.g. | Signature: | <blank> |. The value is
  //                   written into the neighbouring answer cell.
  // UNDERSCORE_BLANK: an underline run ("______") whose caption is on an
  //                   adjacent line, e.g. "____" over "Name of Firm". The value
  //                   replaces the underline.
  // CHECKBOX:         a text checkbox glyph (□/☐) next to an option label, e.g.
  //                   "□Corporation". Ticking writes markChar (☒) over the box;
  //                   `ref` is the option label, `occurrence` disambiguates.
  // For the label kinds, `ref` is the label text and `occurrence` disambiguates
  // repeats. Matching between detection and fill is done via the shared
  // fill-spot finder, so occurrences always align.
  ref: z.string(),
  // 0-based index of which occurrence of `ref` this field targets. Only
  // meaningful for TEXT_LABEL (a doc can repeat the same label); null/0 for the
  // single-target kinds.
  occurrence: z.number().int().min(0).nullable().default(null),
  // Best-effort human label captured at extraction (SDT alias/tag, bookmark, or
  // humanized token text).
  sourceLabel: z.string().nullable().default(null),
});
export type DocxAnchor = z.infer<typeof DocxAnchorSchema>;

// ─── Detected Form Field ───

export const DetectedFormFieldSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  value: z.string().nullable().default(null),
  status: FormFieldStatusSchema.default('EMPTY'),
  confidence: z.number().min(0).max(1).nullable().default(null),
  profileFieldKey: z.string().nullable().default(null),
  manualReason: z.string().nullable().default(null),
  pageNumber: z.number().nullable().default(null),
  cellReference: z.string().nullable().default(null),
  // Which XLSX worksheet this field lives on. `cellReference` is sheet-relative,
  // so multi-sheet workbooks need this to route reads (editor grid) and writes
  // (export filler) to the correct sheet. Null on legacy/single-sheet fields,
  // which every consumer treats as sheet index 0.
  sheetName: z.string().nullable().default(null),
  sheetIndex: z.number().nullable().default(null),
  boundingBox: z.object({
    top: z.number(),
    left: z.number(),
    width: z.number(),
    height: z.number(),
  }).nullable().default(null),
  // Mark metadata for checkbox / circle fields. Default TEXT for back-compat.
  markType: FieldMarkTypeSchema.default('TEXT'),
  markChar: z.string().nullable().default(null),
  markGeometry: FieldMarkGeometrySchema.nullable().default(null),
  // XLSX response-matrix metadata (null on non-matrix forms).
  matrixCategory: z.string().nullable().default(null),
  matrixFeature: z.string().nullable().default(null),
  matrixColumn: MatrixColumnSchema.default('OTHER'),
  // DOCX in-place anchor. Null for COMPANION fields and all non-DOCX forms.
  docxAnchor: DocxAnchorSchema.nullable().default(null),
});

export type DetectedFormField = z.infer<typeof DetectedFormFieldSchema>;

// ─── Required Form Item ───

export const RequiredFormItemSchema = z.object({
  formId: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  name: z.string(),
  formType: FormTypeSchema,
  status: FormProcessingStatusSchema.default('NEW'),
  sourceFileName: z.string(),
  sourceFileKey: z.string(),
  sourcePageRange: z.string().nullable().default(null),
  sourceSheetName: z.string().nullable().default(null),
  // How a DOCX form is exported (in-place fill vs generated companion sheet).
  // Null on non-DOCX forms and legacy records; the filler treats null as COMPANION.
  docxFillStrategy: DocxFillStrategySchema.nullable().default(null),
  fields: z.array(DetectedFormFieldSchema).default([]),
  filledFileKey: z.string().nullable().default(null),
  autoFillPercentage: z.number().min(0).max(100).default(0),
  manualFieldCount: z.number().default(0),
  totalFieldCount: z.number().default(0),
  reviewRequired: z.boolean().default(false),
  reviewedBy: z.string().nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  // Whether this filled form should be bundled into the next RFP proposal package.
  // Auto-set to true when status flips to DONE; user can detach from the UI.
  attachedToProposal: z.boolean().default(false),
  attachedAt: z.string().nullable().default(null),
  // RFP document id created when the form was attached to the proposal.
  // Cleared when the form is detached.
  proposalDocumentId: z.string().nullable().default(null),
  // ── Notary detection (u2-notary-backend-wiring) ──
  // Per-form notary state, stored as TOP-LEVEL attributes (BR9.1) so the UI label
  // reads them without decompressing fieldsGz. Defaults keep legacy records clean.
  // notaryStatus is the strongest-signal status across this form's triggers;
  // notaryRequirements is the evidence array; notarySource guards user overrides
  // (AI_DETECTED is recomputed wholesale, USER_SET survives detection re-runs).
  notaryStatus: NotaryStatusSchema.default('NOT_REQUIRED'),
  notaryRequirements: z.array(NotaryRequirementSchema).default([]),
  notarySource: NotaryClassificationSourceSchema.default('AI_DETECTED'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RequiredFormItem = z.infer<typeof RequiredFormItemSchema>;

// ─── Create DTO ───

export const CreateRequiredFormDTOSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  name: z.string().min(1),
  formType: FormTypeSchema,
  sourceFileName: z.string().min(1),
  sourceFileKey: z.string().min(1),
  sourcePageRange: z.string().nullable().optional(),
  sourceSheetName: z.string().nullable().optional(),
});

export type CreateRequiredFormDTO = z.infer<typeof CreateRequiredFormDTOSchema>;

// ─── Update DTO ───

export const UpdateRequiredFormDTOSchema = z.object({
  status: FormProcessingStatusSchema.optional(),
  docxFillStrategy: DocxFillStrategySchema.nullable().optional(),
  fields: z.array(DetectedFormFieldSchema).optional(),
  filledFileKey: z.string().nullable().optional(),
  autoFillPercentage: z.number().min(0).max(100).optional(),
  manualFieldCount: z.number().optional(),
  totalFieldCount: z.number().optional(),
  reviewRequired: z.boolean().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  attachedToProposal: z.boolean().optional(),
  attachedAt: z.string().nullable().optional(),
  proposalDocumentId: z.string().nullable().optional(),
  // Notary fields — patchable by the detection/callback wiring and by a user edit
  // (a user-originated patch sets notarySource to USER_SET, BR12.1).
  notaryStatus: NotaryStatusSchema.optional(),
  notaryRequirements: z.array(NotaryRequirementSchema).optional(),
  notarySource: NotaryClassificationSourceSchema.optional(),
});

export type UpdateRequiredFormDTO = z.infer<typeof UpdateRequiredFormDTOSchema>;

// ─── Update Field DTO ───

export const UpdateFormFieldDTOSchema = z.object({
  formId: z.string().min(1),
  fieldId: z.string().min(1),
  value: z.string().nullable().optional(),
  label: z.string().optional(),
  status: FormFieldStatusSchema.optional(),
  boundingBox: z.object({
    top: z.number(),
    left: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
  markType: FieldMarkTypeSchema.optional(),
  markChar: z.string().nullable().optional(),
  markGeometry: FieldMarkGeometrySchema.nullable().optional(),
  delete: z.boolean().optional(),
});

export type UpdateFormFieldDTO = z.infer<typeof UpdateFormFieldDTOSchema>;

// ─── API Responses ───

export const RequiredFormsListResponseSchema = z.object({
  forms: z.array(RequiredFormItemSchema),
});

export type RequiredFormsListResponse = z.infer<typeof RequiredFormsListResponseSchema>;
