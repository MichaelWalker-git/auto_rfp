import { z } from 'zod';

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
  fields: z.array(DetectedFormFieldSchema).default([]),
  filledFileKey: z.string().nullable().default(null),
  autoFillPercentage: z.number().min(0).max(100).default(0),
  manualFieldCount: z.number().default(0),
  totalFieldCount: z.number().default(0),
  reviewRequired: z.boolean().default(true),
  reviewedBy: z.string().nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  // Whether this filled form should be bundled into the next RFP proposal package.
  // Auto-set to true when status flips to DONE; user can detach from the UI.
  attachedToProposal: z.boolean().default(false),
  attachedAt: z.string().nullable().default(null),
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
