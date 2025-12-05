import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error("DB_TABLE_NAME environment variable is not set");
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// ----------------------------------------------------
// Handler
// GET /documents/get-document?kbId=<kbId>&id=<documentId>
// ----------------------------------------------------
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const kbId =
      event.queryStringParameters?.kbId ||
      event.pathParameters?.kbId;

    const documentId =
      event.queryStringParameters?.id ||
      event.pathParameters?.id;

    if (!kbId) {
      return apiResponse(400, {
        message: "Missing required parameter: kbId",
      });
    }

    if (!documentId) {
      return apiResponse(400, {
        message: "Missing required parameter: id (documentId)",
      });
    }

    const document = await getDocument(kbId, documentId);

    if (!document) {
      return apiResponse(404, {
        message: "Document not found",
      });
    }

    return apiResponse(200, document);
  } catch (err) {
    console.error("Error in get-document handler:", err);

    return apiResponse(500, {
      message: "Internal server error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};

// ----------------------------------------------------
// Core: get a single document by kbId + documentId
// ----------------------------------------------------
export async function getDocument(
  knowledgeBaseId: string,
  documentId: string
): Promise<any | null> {
  const sk = `KB#${knowledgeBaseId}#DOC#${documentId}`;

  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: "DOCUMENT",
        [SK_NAME]: sk,
      },
    })
  );

  if (!res.Item) {
    return null;
  }

  // Attach plain "id" field for FE convenience
  return {
    ...res.Item,
    id: documentId,
  };
}
