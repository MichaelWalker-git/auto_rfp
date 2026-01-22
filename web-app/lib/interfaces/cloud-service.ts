import {
  DocumentsConnectRequest,
  DocumentsDisconnectRequest,
  DocumentProject,
  DocumentsConnectResponse,
  DocumentsDisconnectResponse,
  DocumentsRequest,
  DocumentsResponse,
  DocumentsPipeline,
  DocumentFile,
} from '@/lib/validators/document-cloud';

/**
 * Interface for generic cloud document API client
 * (implementation can be AWS, LlamaCloud, etc.)
 */
export interface ICloudClient {
  /**
   * Verify credentials and fetch available projects
   */
  verifyCredentialsAndFetchProjects(
    credentials: string,
  ): Promise<DocumentProject[]>;

  /**
   * Check if a specific project is accessible with the credentials
   */
  verifyProjectAccess(
    credentials: string,
    projectId: string,
  ): Promise<DocumentProject>;

  /**
   * Fetch pipelines for a specific project
   */
  fetchPipelinesForProject(
    credentials: string,
    projectId: string,
  ): Promise<DocumentsPipeline[]>;

  /**
   * Fetch files for a specific pipeline
   */
  fetchFilesForPipeline(
    credentials: string,
    pipelineId: string,
  ): Promise<DocumentFile[]>;
}

/**
 * Interface for organization authorization operations
 * (unchanged, still generic)
 */
export interface IOrganizationAuth {
  /**
   * Get current authenticated user
   */
  getCurrentUser(): Promise<{ id: string } | null>;

  /**
   * Get user's role in an organization
   */
  getUserOrganizationRole(
    userId: string,
    organizationId: string,
  ): Promise<string | null>;

  /**
   * Check if user has admin access to organization
   */
  hasAdminAccess(userId: string, organizationId: string): Promise<boolean>;

  /**
   * Check if user is a member of an organization
   */
  isMemberOfOrganization(
    userId: string,
    organizationId: string,
  ): Promise<boolean>;

  /**
   * Get authenticated user and verify membership
   */
  getAuthenticatedMember(
    organizationId: string,
  ): Promise<{ id: string }>;
}

/**
 * Interface for cloud connection management service
 */
export interface ICloudConnectionService {
  /**
   * Connect organization to cloud document provider
   */
  connect(
    request: DocumentsConnectRequest,
    userId: string,
  ): Promise<DocumentsConnectResponse>;

  /**
   * Disconnect organization from cloud document provider
   */
  disconnect(
    request: DocumentsDisconnectRequest,
    userId: string,
  ): Promise<DocumentsDisconnectResponse>;
}

/**
 * Interface for cloud documents service
 */
export interface ICloudDocumentsService {
  /**
   * Get documents and pipelines for an organization
   */
  getDocuments(
    request: DocumentsRequest,
    userId: string,
  ): Promise<DocumentsResponse>;
}

/**
 * Configuration for generic cloud client
 */
export interface CloudClientConfig {
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
}

