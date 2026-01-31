import {
  S3Client,
  ListObjectsV2Command,
  _Object as S3Object, ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';

import { organizationAuth } from './organization-auth';
import {
  CloudConnectionError,
  DatabaseError,
  NotFoundError,
} from '@/lib/errors/api-errors';
import { env } from '@/lib/env';

import {
  DocumentsRequest,
  DocumentsResponse,
  DocumentFile,
} from '@/lib/validators/document-cloud';

import { ICloudDocumentsService } from '@/lib/interfaces/cloud-service';

/** Organization config shape */
type OrgWithDocumentsConfig = {
  id: string;
  name: string;
  documentsBucketName: string | null;
  documentsPrefix: string | null;
  documentsConnectedAt: Date | null;
};

export class S3DocumentsService implements ICloudDocumentsService {
  private s3: S3Client;

  constructor() {
    if (!env.AWS_REGION) {
      throw new CloudConnectionError('AWS_REGION is not configured');
    }

    this.s3 = new S3Client({ region: process.env.AWS_REGION });
  }

  /** Get documents and pipelines from S3 */
  async getDocuments(
    request: DocumentsRequest,
    userId: string,
  ): Promise<DocumentsResponse> {
    try {
      // 1. Authorization
      await organizationAuth.requireMembership(userId, request.organizationId);

      // 2. Organization config
      const organization = await this.getConnectedOrganization(
        request.organizationId,
      );

      const bucket =
        organization.documentsBucketName || process.env.DOCUMENTS_BUCKET;

      if (!bucket) {
        throw new CloudConnectionError('DOCUMENTS_BUCKET is not configured');
      }

      const orgPrefix = this.buildOrgPrefix(organization);

      // 3. Fetch S3 objects
      const objects = await this.listAllObjects(bucket, orgPrefix);

      const pipelinesMap = new Map<
        string,
        { id: string; name: string; prefix: string }
      >();

      const documents: DocumentFile[] = [];

      for (const obj of objects) {
        if (!obj.Key) continue;

        const relativeKey = obj.Key.replace(orgPrefix, '');
        if (!relativeKey) continue;

        const [pipelineSegment, ...rest] = relativeKey.split('/');
        const fileName = rest.join('/') || pipelineSegment;

        const pipelineId = pipelineSegment || 'default';
        const pipelineName = pipelineSegment || 'Default';

        if (!pipelinesMap.has(pipelineId)) {
          pipelinesMap.set(pipelineId, {
            id: pipelineId,
            name: pipelineName,
            prefix: `${orgPrefix}${pipelineSegment}/`,
          });
        }

        const file: DocumentFile = {
          id: obj.Key ?? null,
          name: fileName,
          bucket,
          key: obj.Key ?? null,
          file_size: obj.Size ?? null,
          size_bytes: obj.Size ?? null,
          last_modified_at: obj.LastModified?.toISOString() ?? null,
          status: 'stored',
          pipelineId,
          pipelineName,
        };

        documents.push(file);
      }

      return {
        projectName: organization.name,
        projectId: organization.id,
        pipelines: Array.from(pipelinesMap.values()),
        documents,
        connectedAt: organization.documentsConnectedAt,
      };
    } catch (error) {
      if (
        error instanceof CloudConnectionError ||
        error instanceof DatabaseError ||
        error instanceof NotFoundError
      ) {
        throw error;
      }

      throw new CloudConnectionError(
        `Failed to fetch documents: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Get org record & verify it has connected AWS storage
   * @throws Error - Not implemented yet
   */
  private async getConnectedOrganization(
    _organizationId: string,
  ): Promise<OrgWithDocumentsConfig> {
    // TODO: Implement fetching organization config via Lambda API
    // Should return organization with documentsBucketName, documentsPrefix, etc.
    throw new Error('getConnectedOrganization is not implemented');
  }

  /** Fetch all files for an org across all pipelines */
  async fetchDocumentsForAllPipelines(
    organizationId: string,
  ): Promise<DocumentFile[]> {
    try {
      const organization = await this.getConnectedOrganization(organizationId);

      const bucket =
        organization.documentsBucketName || process.env.DOCUMENTS_BUCKET;

      if (!bucket) {
        throw new CloudConnectionError('DOCUMENTS_BUCKET is not configured');
      }

      const prefix = this.buildOrgPrefix(organization);
      const objects = await this.listAllObjects(bucket, prefix);

      const list: DocumentFile[] = [];

      for (const obj of objects) {
        if (!obj.Key) continue;

        const relativeKey = obj.Key.replace(prefix, '');
        if (!relativeKey) continue;

        const [pipelineSegment, ...rest] = relativeKey.split('/');
        const fileName = rest.join('/') || pipelineSegment;

        const file: DocumentFile = {
          id: obj.Key ?? null,
          name: fileName,
          bucket,
          key: obj.Key ?? null,
          file_size: obj.Size ?? null,
          size_bytes: obj.Size ?? null,
          last_modified_at: obj.LastModified?.toISOString() ?? null,
          status: 'stored',
          pipelineId: pipelineSegment || 'default',
          pipelineName: pipelineSegment || 'Default',
        };

        list.push(file);
      }

      return list;
    } catch (error) {
      if (
        error instanceof CloudConnectionError ||
        error instanceof DatabaseError ||
        error instanceof NotFoundError
      ) {
        throw error;
      }

      throw new CloudConnectionError(
        `Failed to fetch pipeline documents: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /** Build S3 prefix for the org */
  private buildOrgPrefix(
    organization: OrgWithDocumentsConfig,
  ): string {
    if (organization.documentsPrefix) {
      return organization.documentsPrefix.endsWith('/')
        ? organization.documentsPrefix
        : `${organization.documentsPrefix}/`;
    }

    const root = process.env.DOCUMENTS_ROOT_PREFIX || '';
    const normalizedRoot =
      root && !root.endsWith('/') ? `${root}/` : root;

    return `${normalizedRoot}${organization.id}/`;
  }

  /** List S3 objects with pagination */
  private async listAllObjects(
    bucket: string,
    prefix: string,
  ): Promise<S3Object[]> {
    const all: S3Object[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const res: ListObjectsV2CommandOutput = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      if (res.Contents) {
        all.push(...res.Contents);
      }

      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return all;
  }

}

export const documentsService = new S3DocumentsService();
