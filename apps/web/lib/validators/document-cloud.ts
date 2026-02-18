import { z } from 'zod';

/**
 * CONNECT / DISCONNECT
 *
 * We’re now “connecting” an organization to AWS-backed document storage,
 * e.g. an S3 bucket + prefix (and optionally region if not global in env).
 */

// Connect request validation schema
export const DocumentsConnectRequestSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),

  // AWS-specific config
  bucketName: z.string().min(1, 'S3 bucket name is required'),
  bucketRegion: z.string().min(1, 'S3 bucket region is required'),
  rootPrefix: z.string().optional(), // e.g. "documents/<orgId>/"

  // Optional: friendly project name
  projectName: z.string().min(1, 'Project name is required'),
});

// Disconnect request validation schema
export const DocumentsDisconnectRequestSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * “Project” is now a logical concept on top of AWS (bucket/prefix, KB, etc.)
 */
export const DocumentProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

/**
 * Connect response validation schema
 * Organization now stores AWS document config instead of llamaCloud fields.
 */
export const DocumentsConnectResponseSchema = z.object({
  success: z.boolean(),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    // AWS documents configuration persisted on organization
    bucketName: z.string().nullable(),
    bucketConnectedAt: z.date().nullable(),
  }),
});

// Disconnect response validation schema
export const DocumentsDisconnectResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    bucketName: z.string().nullable(),
    bucketConnectedAt: z.date().nullable(),
  }),
});

/**
 * DOCUMENTS LISTING
 */

// Documents request validation schema (for query parameters)
export const DocumentsRequestSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * “Pipeline” in AWS land: usually a logical grouping, e.g. derived from prefixes
 * or from a config (RAG pipeline, ingestion pipeline, etc.).
 */
export const DocumentsPipelineSchema = z.object({
  id: z.string(),                // e.g. prefix name or logical pipeline id
  name: z.string(),              // human-friendly name
  project_id: z.string().nullish(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  status: z.string().nullish(),
});

/**
 * Single document/file entry – mapped from S3 objects (and/or other AWS sources)
 */
export const DocumentFileSchema = z.object({
  id: z.string().nullish(),          // can be same as 'key'
  name: z.string(),                  // file name
  bucket: z.string().nullish(),      // S3 bucket
  key: z.string().nullish(),         // S3 key

  file_size: z.number().nullish(),   // from S3.Size
  file_type: z.string().nullish(),   // from S3.ContentType if available

  project_id: z.string().nullish(),

  last_modified_at: z.string().nullish(), // from S3.LastModified?.toISOString()

  // Additional AWS / RAG metadata (optional)
  data_source_id: z.string().nullish(),   // e.g. Kendra data source id
  custom_metadata: z.any().nullish(),

  // Status / ingestion info
  status: z.string().nullish(),
  status_updated_at: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),

  // Derived / convenience fields
  size_bytes: z.number().nullish(),       // alias for file_size
  pipelineName: z.string().nullish(),
  pipelineId: z.string().nullish(),
});

// Documents response validation schema
export const DocumentsResponseSchema = z.object({
  projectName: z.string().nullable(),
  projectId: z.string().nullable(),
  pipelines: z.array(DocumentsPipelineSchema),
  documents: z.array(DocumentFileSchema),
  connectedAt: z.date().nullable(),
});

/**
 * Type exports (new names)
 */
export type DocumentsConnectRequest = z.infer<typeof DocumentsConnectRequestSchema>;
export type DocumentsDisconnectRequest = z.infer<typeof DocumentsDisconnectRequestSchema>;
export type DocumentProject = z.infer<typeof DocumentProjectSchema>;
export type DocumentsConnectResponse = z.infer<typeof DocumentsConnectResponseSchema>;
export type DocumentsDisconnectResponse = z.infer<typeof DocumentsDisconnectResponseSchema>;

export type DocumentsRequest = z.infer<typeof DocumentsRequestSchema>;
export type DocumentsPipeline = z.infer<typeof DocumentsPipelineSchema>;
export type DocumentFile = z.infer<typeof DocumentFileSchema>;
export type DocumentsResponse = z.infer<typeof DocumentsResponseSchema>;
