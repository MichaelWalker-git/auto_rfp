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
          // optional: bucketConnectedAt if you add it to Prisma
          bucketConnectedAt:
            (updatedOrganization as any).bucketConnectedAt ?? null,
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
          bucketConnectedAt:
            (updatedOrganization as any).bucketConnectedAt ?? null,
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
   */
  private async updateOrganizationBucket(
    organizationId: string,
    bucketName: string,
  ) {
    try {
      // TODO: call appropriate lambda
      return { } as any
    } catch (error) {
      throw new DatabaseError(
        `Failed to update organization bucket: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Clear bucketName from organization
   */
  private async clearOrganizationBucket(organizationId: string) {
    try {
      return {} as any;
    } catch (error) {
      throw new DatabaseError(
        `Failed to clear organization bucket: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Optional helper: connection stats
   */
  async getConnectionStats(organizationId: string): Promise<{
    isConnected: boolean;
    bucketName: string | null;
    bucketConnectedAt: Date | null;
  }> {
    try {
      const organization = { } as any

      const isConnected = !!organization?.bucketName;

      return {
        isConnected,
        bucketName: organization?.bucketName ?? null,
        bucketConnectedAt: (organization as any)?.bucketConnectedAt ?? null,
      };
    } catch (error) {
      throw new DatabaseError(
        `Failed to get bucket connection stats: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }
}

// Export singleton instance
export const cloudConnectionService = new CloudConnectionService();
