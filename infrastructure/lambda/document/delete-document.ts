import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { GetCommand, } from '@aws-sdk/lib-dynamodb';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';

import { DeleteDocumentDTO, DeleteDocumentDTOSchema, } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import { requireEnv } from '../helpers/env';
import { deleteItem, docClient } from '../helpers/db';
import { deleteFromPinecone } from '../helpers/pinecone';


const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is missing' });
    }

    // Parse JSON
    let json: any;
    try {
      json = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON format' });
    }

    // Validate with Zod
    const parsed = DeleteDocumentDTOSchema.safeParse(json);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors,
      });
    }

    const dto: DeleteDocumentDTO = parsed.data;

    await deleteDocument(dto);

    return apiResponse(200, {
      success: true,
      id: dto.id,
      knowledgeBaseId: dto.knowledgeBaseId,
    });
  } catch (err) {
    console.error('Error in delete-document handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// -------------------------------------------------------------
// Core logic: remove document files from S3, delete from Pinecone,
// then remove record from DynamoDB
// -------------------------------------------------------------
async function deleteDocument(dto: DeleteDocumentDTO): Promise<void> {
  const sk = `KB#${dto.knowledgeBaseId}#DOC#${dto.id}`;

  // 1) Load DB record so we know the file keys
  const getRes = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  if (!getRes.Item) {
    console.warn(
      `deleteDocument: no document found for PK=${DOCUMENT_PK}, SK=${sk}; nothing to delete`,
    );
  } else {
    const item = getRes.Item as {
      fileKey?: string;
      textFileKey?: string;
    };

    const deletes: Promise<any>[] = [];

    if (item.fileKey) {
      console.log(
        'Deleting original file from S3:',
        DOCUMENTS_BUCKET,
        item.fileKey,
      );
      deletes.push(
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: DOCUMENTS_BUCKET,
            Key: item.fileKey,
          }),
        ),
      );
    } else {
      console.log(
        `deleteDocument: no fileKey on item PK=${DOCUMENT_PK}, SK=${sk}`,
      );
    }

    if (item.textFileKey) {
      console.log(
        'Deleting text file from S3:',
        DOCUMENTS_BUCKET,
        item.textFileKey,
      );
      deletes.push(
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: DOCUMENTS_BUCKET,
            Key: item.textFileKey,
          }),
        ),
      );
    } else {
      console.log(
        `deleteDocument: no textFileKey on item PK=${DOCUMENT_PK}, SK=${sk}`,
      );
    }

    if (deletes.length > 0) {
      await Promise.all(deletes);
    }
  }

  // 2) Delete from Pinecone by documentId
  try {
    await deleteFromPinecone(dto.id);
  } catch (err) {
    console.error(
      `Failed to delete documentId=${dto.id} from Pinecone:`,
      err,
    );
    // depending on how strict you want to be, you can throw here
    // throw err;
  }

  // 3) Delete DynamoDB record
  console.log(
    'Deleting document record from DynamoDB',
    DB_TABLE_NAME,
    DOCUMENT_PK,
    sk,
  );

  await deleteItem(DOCUMENT_PK, sk);
}


export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:delete'))
    .use(httpErrorMiddleware())
);
