import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { apiResponse } from '../helpers/api';

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_BUCKET = process.env.DOCUMENTS_BUCKET;

if (!DEFAULT_BUCKET) {
  throw new Error("DOCUMENTS_BUCKET environment variable is not set");
}

const s3 = new S3Client({ region: REGION });

interface GetTextRequestBody {
  s3Key?: string;
  s3Bucket?: string; // optional override
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: "Request body is required" });
    }

    // Parse JSON body
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;

    let body: GetTextRequestBody;
    try {
      body = JSON.parse(raw);
    } catch {
      return apiResponse(400, { message: "Invalid JSON in request body" });
    }

    const { s3Key, s3Bucket } = body;

    if (!s3Key) {
      return apiResponse(400, {
        message: "'s3Key' is required in the request body",
      });
    }

    const bucketToUse = s3Bucket || DEFAULT_BUCKET;

    // 1) Load text file from S3
    const text = await getTextFromS3(bucketToUse, s3Key);

    if (!text.trim()) {
      return apiResponse(404, {
        message: "Text file is empty or unreadable",
        s3Key,
        bucket: bucketToUse,
      });
    }

    // 2) Return content
    return apiResponse(200, {
      bucket: bucketToUse,
      key: s3Key,
      length: text.length,
      content: text,
    });
  } catch (err) {
    console.error("Error in get-text Lambda:", err);
    return apiResponse(500, {
      message: "Failed to read text from S3",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};

// 🔧 Helper: read entire S3 object into a UTF-8 string
async function getTextFromS3(bucket: string, key: string): Promise<string> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!res.Body) {
    throw new Error("Empty S3 object body");
  }

  const body: any = res.Body;

  // Modern AWS SDK: Body.transformToString()
  if (typeof body.transformToString === "function") {
    return await body.transformToString("utf8");
  }

  // Older SDK stream fallback
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on("data", (chunk: Buffer) => chunks.push(chunk));
    body.on("error", reject);
    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
