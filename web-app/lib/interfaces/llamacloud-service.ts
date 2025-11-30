import { 
  LlamaCloudConnectRequest, 
  LlamaCloudDisconnectRequest, 
  LlamaCloudProject,
  LlamaCloudConnectResponse,
  LlamaCloudDisconnectResponse,
  LlamaCloudDocumentsRequest,
  LlamaCloudDocumentsResponse,
  LlamaCloudPipeline,
  LlamaCloudFile
} from '@/lib/validators/llamacloud';

/**
 * Interface for LlamaCloud API client
 */
export interface ILlamaCloudClient {
  /**
   * Verify API key and fetch available projects
   */
  verifyApiKeyAndFetchProjects(apiKey: string): Promise<LlamaCloudProject[]>;
  
  /**
   * Check if a specific project is accessible with the API key
   */
  verifyProjectAccess(apiKey: string, projectId: string): Promise<LlamaCloudProject>;
  
  /**
   * Fetch pipelines for a specific project
   */
  fetchPipelinesForProject(apiKey: string, projectId: string): Promise<LlamaCloudPipeline[]>;
  
  /**
   * Fetch files for a specific pipeline
   */
  fetchFilesForPipeline(apiKey: string, pipelineId: string): Promise<LlamaCloudFile[]>;
}

/**
 * Interface for organization authorization operations
 */
export interface IOrganizationAuth {
  /**
   * Get current authenticated user
   */
  getCurrentUser(): Promise<{ id: string } | null>;
  
  /**
   * Get user's role in an organization
   */
  getUserOrganizationRole(userId: string, organizationId: string): Promise<string | null>;
  
  /**
   * Check if user has admin access to organization
   */
  hasAdminAccess(userId: string, organizationId: string): Promise<boolean>;
  
  /**
   * Check if user is a member of an organization
   */
  isMemberOfOrganization(userId: string, organizationId: string): Promise<boolean>;
  
  /**
   * Get authenticated user and verify membership
   */
  getAuthenticatedMember(organizationId: string): Promise<{ id: string }>;
}

/**
 * Interface for LlamaCloud connection management service
 */
export interface ILlamaCloudConnectionService {
  /**
   * Connect organization to LlamaCloud
   */
  connectToLlamaCloud(request: LlamaCloudConnectRequest, userId: string): Promise<LlamaCloudConnectResponse>;
  
  /**
   * Disconnect organization from LlamaCloud
   */
  disconnectFromLlamaCloud(request: LlamaCloudDisconnectRequest, userId: string): Promise<LlamaCloudDisconnectResponse>;
}

/**
 * Interface for LlamaCloud documents service
 */
export interface ILlamaCloudDocumentsService {
  /**
   * Get documents and pipelines for an organization
   */
  getDocuments(request: LlamaCloudDocumentsRequest, userId: string): Promise<LlamaCloudDocumentsResponse>;
}

/**
 * Configuration for LlamaCloud client
 */
export interface LlamaCloudClientConfig {
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
} 