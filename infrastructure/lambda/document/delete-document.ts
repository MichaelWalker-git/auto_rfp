import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';

import { DeleteDocumentDTO, DeleteDocumentDTOSchema, } from '../schemas/document';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error("DB_TABLE_NAME environment variable is not set");
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// -------------------------------------------------------------
// DELETE /documents/delete-document
// Body: { id: string, knowledgeBaseId: string }
// -------------------------------------------------------------
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: "Request body is missing" });
    }

    // Parse JSON
    let json: any;
    try {
      json = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: "Invalid JSON format" });
    }

    // Validate with Zod
    const parsed = DeleteDocumentDTOSchema.safeParse(json);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      return apiResponse(400, {
        message: "Validation failed",
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
    console.error("Error in delete-document handler:", err);

    return apiResponse(500, {
      message: "Internal server error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};

// -------------------------------------------------------------
// Core logic: remove document from DynamoDB
// -------------------------------------------------------------
async function deleteDocument(dto: DeleteDocumentDTO): Promise<void> {
  const sk = `KB#${dto.knowledgeBaseId}#DOC#${dto.id}`;

  await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: "DOCUMENT",
        [SK_NAME]: sk,
      },
    }),
  );
}
