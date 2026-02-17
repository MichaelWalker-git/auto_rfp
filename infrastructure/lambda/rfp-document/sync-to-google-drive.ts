import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { apiResponse, getOrgId } from '../helpers/api';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { nowIso } from '../helpers/date';
import { getApiKey } from '../helpers/api-key-storage';
import { GOOGLE_SECRET_PREFIX } from '../constants/google';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';
import { PK_NAME, SK_NAME } from '../constants/common';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { google } from 'googleapis';
import { Readable } from 'stream';

/** Map document types to Google Drive folder names */
const DOCUMENT_TYPE_FOLDERS: Record<string, string> = {
  TECHNICAL_PROPOSAL: 'Technical Proposals',
  EXECUTIVE_BRIEF: 'Executive Briefs',
  EXECUTIVE_SUMMARY: 'Executive Summaries',
  COST_PROPOSAL: 'Cost Proposals',
  PAST_PERFORMANCE: 'Past Performance',
  MANAGEMENT_APPROACH: 'Management Approach',
  MANAGEMENT_PROPOSAL: 'Management Proposals',
  PRICE_VOLUME: 'Price Volume',
  CERTIFICATIONS: 'Certifications',
  COMPLIANCE_MATRIX: 'Compliance Matrices',
  TEAMING_AGREEMENT: 'Teaming Agreements',
  NDA: 'NDAs',
  CONTRACT: 'Contracts',
  AMENDMENT: 'Amendments',
  CORRESPONDENCE: 'Correspondence',
  OTHER: 'Other Documents',
};

function getTypeFolderName(documentType: string): string {
  return DOCUMENT_TYPE_FOLDERS[documentType] ?? (DOCUMENT_TYPE_FOLDERS.OTHER as string);
}

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const s3 = new S3Client({ region: REGION });

const SyncRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
});

async function getDriveClient(orgId: string) {
  const serviceAccountJson = await getApiKey(orgId, GOOGLE_SECRET_PREFIX);
  if (!serviceAccountJson) {
    throw new Error('Google Service Account key not configured for this organization');
  }
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string,
): Promise<string> {
  const query = [
    `name='${name.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${parentId}' in parents` : undefined,
  ]
    .filter(Boolean)
    .join(' and ');

  const existing = await drive.files.list({
    q: query,
    fields: 'files(id,name)',
    spaces: 'drive',
  });

  const firstFile = existing.data.files?.[0];
  if (firstFile?.id) {
    return firstFile.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });

  return created.data.id!;
}

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const parsed = SyncRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!parsed.success) {
      return apiResponse(400, { error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { projectId, opportunityId, documentId } = parsed.data;
    const sk = `${projectId}#${opportunityId}#${documentId}`;

    // 1. Get the document from DB
    const docResult = await docClient.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      }),
    );

    const doc = docResult.Item;
    if (!doc || doc.deletedAt) {
      return apiResponse(404, { error: 'Document not found' });
    }

    // 2. Get Drive client
    const drive = await getDriveClient(orgId);

    // 3. Create folder structure: RFP Documents / <projectId> / <Document Type Folder>
    const rootFolderId = await findOrCreateFolder(drive, 'RFP Documents');
    const projectFolderId = await findOrCreateFolder(drive, projectId, rootFolderId);
    const typeFolderName = getTypeFolderName(doc.documentType || 'OTHER');
    const typeFolderId = await findOrCreateFolder(drive, typeFolderName, projectFolderId);

    let googleDriveFileId: string;
    let googleDriveUrl: string;

    if (doc.fileKey) {
      // Upload file from S3
      const s3Result = await s3.send(
        new GetObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: doc.fileKey,
        }),
      );

      const stream = s3Result.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const uploadResult = await drive.files.create({
        requestBody: {
          name: doc.name || doc.originalFileName || documentId,
          parents: [typeFolderId],
          mimeType: doc.mimeType || 'application/octet-stream',
        },
        media: {
          mimeType: doc.mimeType || 'application/octet-stream',
          body: Readable.from(buffer),
        },
        fields: 'id,webViewLink',
      });

      googleDriveFileId = uploadResult.data.id!;
      googleDriveUrl = uploadResult.data.webViewLink!;
    } else if (doc.content) {
      // Upload content as JSON
      const contentStr = JSON.stringify(doc.content, null, 2);
      const fileName = `${doc.name || documentId}.json`;

      const uploadResult = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [typeFolderId],
          mimeType: 'application/json',
        },
        media: {
          mimeType: 'application/json',
          body: Readable.from(Buffer.from(contentStr, 'utf-8')),
        },
        fields: 'id,webViewLink',
      });

      googleDriveFileId = uploadResult.data.id!;
      googleDriveUrl = uploadResult.data.webViewLink!;
    } else {
      return apiResponse(400, { error: 'Document has no file or content to sync' });
    }

    // 4. Update DB record with Google Drive info
    const now = nowIso();
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
        UpdateExpression:
          'SET googleDriveFileId = :fileId, googleDriveUrl = :url, updatedAt = :now',
        ExpressionAttributeValues: {
          ':fileId': googleDriveFileId,
          ':url': googleDriveUrl,
          ':now': now,
        },
      }),
    );

    return apiResponse(200, {
      message: 'Document synced to Google Drive',
      googleDriveFileId,
      googleDriveUrl,
    });
  } catch (error) {
    console.error('Error syncing RFP document to Google Drive:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to sync document to Google Drive';
    return apiResponse(500, { error: message });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:edit'))
    .use(httpErrorMiddleware()),
);
