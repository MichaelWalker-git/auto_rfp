import { ICloudConnectionService } from '@/lib/interfaces/cloud-service';
import {
  DocumentsConnectRequest,
  DocumentsDisconnectRequest,
  DocumentsConnectResponse,
  DocumentsDisconnectResponse,
} from '@/lib/validators/document-cloud';
import { organizationAuth } from './organization-auth';
import {
  CloudConnectionError,
  DatabaseError,
} from '@/lib/errors/api-errors';

/**
 * Main cloud connection management service:
 * just associates an S3 bucket with an organization.
 */
export class CloudConnectionService implements ICloudConnectionService {
  /**
   * Connect organization to a bucket
   */
  async connect(
    request: DocumentsConnectRequest,
    userId: string,
  ): Promise<DocumentsConnectResponse> {
    try {
      // 1. Verify user has admin access
      await organizationAuth.requireAdminAccess(userId, request.organizationId);

      // 2. Resolve bucket name (prefer request, fall back to env if you want)
      const bucketName =
        request.bucketName || process.env.DOCUMENTS_BUCKET || '';

      if (!bucketName) {
        throw new CloudConnectionError(
          'Bucket name is required to connect documents storage',
        );
      }

      // 3. Update organization with bucketName
      const updatedOrganization = await this.updateOrganizationBucket(
        request.organizationId,
        bucketName,
      );

      // 4. Build response
      const response: DocumentsConnectResponse = {
        success: true,
        organization: {
          id: updatedOrganization.id,
          name: updatedOrganization.name,
          bucketName: updatedOrganization.bucketName,
          bucketConnectedAt: updatedOrganization.bucketConnectedAt ?? null,
        },
      };

      return response;
    } catch (error) {
      if (error instanceof CloudConnectionError || error instanceof DatabaseError) {
        throw error;
      }
      throw new CloudConnectionError(
        `Failed to connect bucket to organization: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Disconnect organization from bucket
   */
  async disconnect(
    request: DocumentsDisconnectRequest,
    userId: string,
  ): Promise<DocumentsDisconnectResponse> {
    try {
      // 1. Verify user has admin access
      await organizationAuth.requireAdminAccess(userId, request.organizationId);

      // 2. Clear bucketName (and optional connectedAt)
      const updatedOrganization = await this.clearOrganizationBucket(
        request.organizationId,
      );

      // 3. Return success response
      const response: DocumentsDisconnectResponse = {
        success: true,
        message: 'Successfully disconnected bucket from organization',
        organization: {
          id: updatedOrganization.id,
          name: updatedOrganization.name,
          bucketName: updatedOrganization.bucketName, // should be null now
          bucketConnectedAt: updatedOrganization.bucketConnectedAt ?? null,
        },
      };

      return response;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to disconnect bucket from organization: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Update organization with bucketName
   * @throws Error - Not implemented yet
   */
  private async updateOrganizationBucket(
    _organizationId: string,
    _bucketName: string,
  ): Promise<{ id: string; name: string; bucketName: string | null; bucketConnectedAt?: Date | null }> {
    // TODO: Implement organization bucket update via Lambda API
    throw new Error('updateOrganizationBucket is not implemented');
  }

  /**
   * Clear bucketName from organization
   * @throws Error - Not implemented yet
   */
  private async clearOrganizationBucket(
    _organizationId: string,
  ): Promise<{ id: string; name: string; bucketName: string | null; bucketConnectedAt?: Date | null }> {
    // TODO: Implement organization bucket clear via Lambda API
    throw new Error('clearOrganizationBucket is not implemented');
  }

  /**
   * Optional helper: connection stats
   * @throws Error - Not implemented yet
   */
  async getConnectionStats(_organizationId: string): Promise<{
    isConnected: boolean;
    bucketName: string | null;
    bucketConnectedAt: Date | null;
  }> {
    // TODO: Implement fetching organization bucket status via Lambda API
    throw new Error('getConnectionStats is not implemented');
  }
}

// Export singleton instance
export const cloudConnectionService = new CloudConnectionService();
