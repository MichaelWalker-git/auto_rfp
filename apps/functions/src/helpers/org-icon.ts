import { PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ORG_PK } from '../constants/organization';
import { requireEnv } from './env';
import { docClient } from './db';
import { nowIso } from './date';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const s3Client = new S3Client({});

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const MAX_ICON_SIZE = 5 * 1024 * 1024; // 5 MB

export interface UploadIconInput {
  orgId: string;
  contentType: string;
  fileSizeBytes?: number;
}

export interface UploadIconResult {
  uploadUrl: string;
  iconUrl: string;
  iconKey: string;
  bucket: string;
  expiresIn: number;
}

export interface GetIconResult {
  iconUrl: string;
  iconKey?: string;
  expiresIn?: number;
}

function resolveExtension(contentType: string): string {
  const ext = contentType.split('/')[1] || 'png';
  return ext === 'svg+xml' ? 'svg' : ext;
}

function buildIconKey(orgId: string, extension: string): string {
  return `organizations/${orgId}/icon/icon.${extension}`;
}

export function validateIconInput(input: UploadIconInput): string | null {
  if (!input.contentType) return 'contentType is required';
  if (!ALLOWED_IMAGE_TYPES.has(input.contentType)) {
    return `Unsupported image type: ${input.contentType}. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}`;
  }
  if (input.fileSizeBytes && input.fileSizeBytes > MAX_ICON_SIZE) {
    return `File too large. Maximum: ${MAX_ICON_SIZE} bytes (5 MB)`;
  }
  return null;
}

export async function generateIconUploadUrl(input: UploadIconInput): Promise<UploadIconResult> {
  const extension = resolveExtension(input.contentType);
  const iconKey = buildIconKey(input.orgId, extension);
  const expiresIn = 900;

  const putCmd = new PutObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: iconKey,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client as any, putCmd, { expiresIn });

  // Generate a presigned GET URL so the icon can be displayed immediately after upload
  const getCmd = new GetObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: iconKey,
    ResponseContentDisposition: 'inline',
  });
  const iconUrl = await getSignedUrl(s3Client as any, getCmd, { expiresIn: 3600 });

  return { uploadUrl, iconUrl, iconKey, bucket: DOCUMENTS_BUCKET, expiresIn };
}

export async function saveIconToOrg(orgId: string, iconKey: string): Promise<void> {
  const now = nowIso();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: ORG_PK,
        [SK_NAME]: `ORG#${orgId}`,
      },
      UpdateExpression: 'SET #iconKey = :iconKey, #updatedAt = :now REMOVE #iconUrl',
      ExpressionAttributeNames: {
        '#iconKey': 'iconKey',
        '#updatedAt': 'updatedAt',
        '#iconUrl': 'iconUrl',
      },
      ExpressionAttributeValues: {
        ':iconKey': iconKey,
        ':now': now,
      },
    }),
  );
}

export async function getOrgIcon(orgId: string): Promise<GetIconResult | null> {
  const { Item: org } = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: ORG_PK,
        [SK_NAME]: `ORG#${orgId}`,
      },
      ProjectionExpression: 'iconKey',
    }),
  );

  if (!org) return null;

  const iconKey = org.iconKey as string | undefined;
  if (!iconKey) return null;

  const expiresIn = 3600;
  const getCmd = new GetObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: iconKey,
    ResponseContentDisposition: 'inline',
  });

  const presignedUrl = await getSignedUrl(s3Client as any, getCmd, { expiresIn });
  return { iconUrl: presignedUrl, iconKey, expiresIn };
}
