import { z } from 'zod';

// Connect request validation schema
export const LlamaCloudConnectRequestSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  projectName: z.string().min(1, 'Project name is required'),
  llamaCloudOrgName: z.string().optional(),
});

// Disconnect request validation schema
export const LlamaCloudDisconnectRequestSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

// LlamaCloud project schema (from API response)
export const LlamaCloudProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

// Connect response validation schema
export const LlamaCloudConnectResponseSchema = z.object({
  success: z.boolean(),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    llamaCloudApiKey: z.string().nullable(),
    llamaCloudProjectId: z.string().nullable(),
    llamaCloudProjectName: z.string().nullable(),
    llamaCloudOrgName: z.string().nullable(),
    llamaCloudConnectedAt: z.date().nullable(),
  }),
});

// Disconnect response validation schema
export const LlamaCloudDisconnectResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    llamaCloudApiKey: z.null(),
    llamaCloudProjectId: z.null(),
    llamaCloudProjectName: z.null(),
    llamaCloudConnectedAt: z.null(),
  }),
});

// Documents request validation schema (for query parameters)
export const LlamaCloudDocumentsRequestSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

// LlamaCloud pipeline schema
export const LlamaCloudPipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  project_id: z.string(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  status: z.string().nullish(),
});

// LlamaCloud file/document schema
export const LlamaCloudFileSchema = z.object({
  id: z.string().nullish(),
  name: z.string(), // This is the actual field name from the API
  external_file_id: z.string().nullish(),
  file_size: z.number().nullish(),
  file_type: z.string().nullish(),
  project_id: z.string().nullish(),
  last_modified_at: z.string().nullish(),
  resource_info: z.object({
    file_size: z.number().nullish(),
    last_modified_at: z.string().nullish(),
  }).nullish(),
  permission_info: z.any().nullish(),
  data_source_id: z.string().nullish(),
  file_id: z.string().nullish(),
  pipeline_id: z.string().nullish(),
  custom_metadata: z.any().nullish(),
  config_hash: z.object({
    parsing_config_hash: z.string().nullish(),
    embedding_config_hash: z.string().nullish(),
    transform_config_hash: z.string().nullish(),
  }).nullish(),
  indexed_page_count: z.number().nullish(),
  status: z.string().nullish(),
  status_updated_at: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Keep these for backward compatibility
  size_bytes: z.number().nullish(),
  pipelineName: z.string().nullish(),
  pipelineId: z.string().nullish(),
});

// Documents response validation schema
export const LlamaCloudDocumentsResponseSchema = z.object({
  projectName: z.string().nullable(),
  projectId: z.string().nullable(),
  pipelines: z.array(LlamaCloudPipelineSchema),
  documents: z.array(LlamaCloudFileSchema),
  connectedAt: z.date().nullable(),
});

// Type exports
export type LlamaCloudConnectRequest = z.infer<typeof LlamaCloudConnectRequestSchema>;
export type LlamaCloudDisconnectRequest = z.infer<typeof LlamaCloudDisconnectRequestSchema>;
export type LlamaCloudProject = z.infer<typeof LlamaCloudProjectSchema>;
export type LlamaCloudConnectResponse = z.infer<typeof LlamaCloudConnectResponseSchema>;
export type LlamaCloudDisconnectResponse = z.infer<typeof LlamaCloudDisconnectResponseSchema>;

// Additional type exports
export type LlamaCloudDocumentsRequest = z.infer<typeof LlamaCloudDocumentsRequestSchema>;
export type LlamaCloudPipeline = z.infer<typeof LlamaCloudPipelineSchema>;
export type LlamaCloudFile = z.infer<typeof LlamaCloudFileSchema>;
export type LlamaCloudDocumentsResponse = z.infer<typeof LlamaCloudDocumentsResponseSchema>; 