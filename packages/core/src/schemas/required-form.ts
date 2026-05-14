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
});

export type DetectedFormField = z.infer<typeof DetectedFormFieldSchema>;
