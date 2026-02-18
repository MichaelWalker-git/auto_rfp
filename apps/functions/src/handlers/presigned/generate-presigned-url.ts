import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';
import { apiResponse } from '@/helpers/api';
import { v4 as uuidv4 } from 'uuid';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { FILE_PK } from '@/constants/file';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { nowIso } from '@/helpers/date';

const BUCKET_NAME = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const URL_EXPIRATION_SECONDS = Number(process.env.PRESIGN_EXPIRES_IN || 900);
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const s3Client = new S3Client({ region: REGION });

type Operation = 'upload' | 'download';

interface PresignRequestBody {
  operation?: Operation;      // "upload" | "download"
  key?: string;               // existing key for download OR custom key for upload
  fileName?: string;          // optional, for upload – used to build key
  contentType?: string;       // required for upload
  prefix?: string;            // optional folder, e.g. "org-123/"
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    let body: PresignRequestBody;
    try {
      body = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const { operation, key, fileName, contentType, prefix } = body;

    if (operation !== 'upload' && operation !== 'download') {
      return apiResponse(400, {
        message: 'Invalid \'operation\'. Must be \'upload\' or \'download\'.',
      });
    }

    // Normalize prefix to "prefix/" or "".
    const safePrefix = prefix
      ? prefix.replace(/^\/+/, '').replace(/\/+$/, '') + '/'
      : '';

    if (operation === 'upload') {
      // Extra validations for upload
      if (!contentType) {
        return apiResponse(400, {
          message: 'For \'upload\', \'contentType\' is required.',
        });
      }
      const fileId = uuidv4();

      // If caller passed a key, use it; otherwise generate one based on fileName/uuid
      const objectKey =
        key ??
        (fileName
          ? `${safePrefix}/${fileId}/${sanitizeFileName(fileName)}`
          : `${safePrefix}/${fileId}`);

      const putObjectCmd = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: objectKey,
        ContentType: contentType,
      });

      const url = await getSignedUrl(s3Client as any, putObjectCmd, {
        expiresIn: URL_EXPIRATION_SECONDS,
      });

      const now = nowIso();
      const sortKey = `${fileId}`;

      const fileItem = {
        [PK_NAME]: FILE_PK,
        [SK_NAME]: sortKey,
        fileId,
        bucket: BUCKET_NAME,
        key: objectKey,
        fileName: fileName ?? null,
        contentType,
        createdAt: now,
        updatedAt: now,
      };

      await docClient.send(new PutCommand({
          TableName: DB_TABLE_NAME,
          Item: fileItem,
        }),
      );

      return apiResponse(200, {
        operation: 'upload',
        bucket: BUCKET_NAME,
        key: objectKey,
        url,
        method: 'PUT',
        expiresIn: URL_EXPIRATION_SECONDS,
        file: {
          fileId,
          sortKey,
        },
      });
    }

    if (!key) {
      return apiResponse(400, {
        message: 'For \'download\', \'key\' is required.',
      });
    }

    const objectKey = key;

    const getObjectCmd = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
    });

    const url = await getSignedUrl(s3Client as any, getObjectCmd, {
      expiresIn: URL_EXPIRATION_SECONDS,
    });

    return apiResponse(200, {
      operation: 'download',
      bucket: BUCKET_NAME,
      key: objectKey,
      url,
      method: 'GET',
      expiresIn: URL_EXPIRATION_SECONDS,
    });
  } catch (err) {
    console.error('Error generating presigned URL:', err);
    return apiResponse(500, {
      message: 'Failed to generate presigned URL',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

function sanitizeFileName(name: string): string {
  return name.replace(/[\/\\]/g, '_');
}

export const handler = withSentryLambda(baseHandler);