import { z } from 'zod';

// Supported file extensions
export const SUPPORTED_FILE_EXTENSIONS = [
  'csv',
  'xlsx',
  'xls',
  'pdf',
  'doc',
  'docx',
] as const;

// Document parse request validation schema
export const DocumentParseRequestSchema = z.object({
  file: z.instanceof(File, { message: 'Valid file is required' }),
  fast_mode: z.boolean().optional().default(false),
  premium_mode: z.boolean().optional().default(false),
  preset: z.enum(['complexTables']).optional(),
  documentName: z.string().optional(),
});

// Document parse options schema
export const DocumentParseOptionsSchema = z.object({
  fastMode: z.boolean().default(false),
  premiumMode: z.boolean().default(false),
  complexTables: z.boolean().default(false),
});

// File validation schema
export const FileValidationSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  size: z.number().positive('File size must be positive'),
  type: z.string().min(1, 'File type is required'),
});

// Document parse result schema (from service)
export const DocumentParseResultSchema = z.object({
  s3Key: z.string(),
  projectId: z.string().optional()
});

// Document parse response validation schema
export const DocumentParseResponseSchema = z.object({
  success: z.boolean(),
  documentId: z.string(),
  documentName: z.string(),
  status: z.string(),
  content: z.string(),
  metadata: z.record(z.any()).optional(),
});

// Type exports (new names)
export type DocumentParseRequest = z.infer<typeof DocumentParseRequestSchema>;
export type DocumentParseOptions = z.infer<typeof DocumentParseOptionsSchema>;
export type FileValidation = z.infer<typeof FileValidationSchema>;
export type DocumentParseResult = z.infer<typeof DocumentParseResultSchema>;
export type DocumentParseResponse = z.infer<typeof DocumentParseResponseSchema>;
