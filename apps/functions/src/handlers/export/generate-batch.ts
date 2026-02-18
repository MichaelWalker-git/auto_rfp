import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import JSZip from 'jszip';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { getRFPDocument } from '@/helpers/rfp-document';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import {
  type ExportFormat,
  flattenProposalToText,
  proposalToHtml,
  proposalToMarkdown,
  sanitizeFileName,
} from './export-utils';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

interface BatchExportRequest {
  projectId: string;
  proposalId: string;
  opportunityId: string;
  formats?: ExportFormat[];
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body: BatchExportRequest = JSON.parse(event.body);
    const { projectId, proposalId, opportunityId, formats } = body;

    if (!projectId || !proposalId || !opportunityId) {
      return apiResponse(400, { message: 'projectId, proposalId, and opportunityId are required' });
    }

    const rfpDoc = await getRFPDocument(projectId, opportunityId, proposalId);
    if (!rfpDoc || rfpDoc.deletedAt) { return apiResponse(404, { message: 'Document not found' }); }
    if (!rfpDoc.content) { return apiResponse(400, { message: 'Document has no structured content' }); }
    const proposal = { id: rfpDoc.documentId, organizationId: rfpDoc.orgId, document: rfpDoc.content as any };

    const organizationId = proposal.organizationId || getOrgId(event) || 'DEFAULT';
    const doc = proposal.document;
    const baseName = sanitizeFileName(doc.proposalTitle);

    const requestedFormats: ExportFormat[] = formats && formats.length > 0
      ? formats.filter(f => ['html', 'txt', 'md'].includes(f))
      : ['html', 'txt', 'md'];

    const zip = new JSZip();
    const generatedFormats: string[] = [];

    for (const format of requestedFormats) {
      try {
        let content: string;
        let fileName: string;

        switch (format) {
          case 'html':
            content = proposalToHtml(doc);
            fileName = `${baseName}.html`;
            break;
          case 'txt':
            content = flattenProposalToText(doc);
            fileName = `${baseName}.txt`;
            break;
          case 'md':
            content = proposalToMarkdown(doc);
            fileName = `${baseName}.md`;
            break;
          default:
            continue;
        }

        zip.file(fileName, content);
        generatedFormats.push(format);
      } catch (formatErr) {
        console.warn(`Failed to generate ${format} format:`, formatErr);
      }
    }

    if (generatedFormats.length === 0) {
      return apiResponse(500, { message: 'Failed to generate any export formats' });
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const key = `${organizationId}/${projectId}/${opportunityId}/${proposalId}/${baseName}_exports.zip`;

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: zipBuffer,
      ContentType: 'application/zip',
    }));

    const url = await getSignedUrl(s3Client as any, new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
    }), { expiresIn: PRESIGN_EXPIRES_IN });

    return apiResponse(200, {
      success: true,
      proposal: { id: proposal.id, title: doc.proposalTitle },
      export: {
        format: 'zip',
        bucket: DOCUMENTS_BUCKET,
        key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: 'application/zip',
        fileName: `${baseName}_exports.zip`,
        includedFormats: generatedFormats,
      },
    });
  } catch (err) {
    console.error('Error generating batch export:', err);
    return apiResponse(500, {
      message: 'Failed to generate batch export',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:export'))
    .use(httpErrorMiddleware()),
);