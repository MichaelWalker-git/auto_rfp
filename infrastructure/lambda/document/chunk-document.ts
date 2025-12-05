import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Readable } from "stream";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const BUCKET = process.env.DOCUMENTS_BUCKET!;
const DB_TABLE = process.env.DB_TABLE_NAME!;

if (!BUCKET) throw new Error("DOCUMENTS_BUCKET missing");
if (!DB_TABLE) throw new Error("DB_TABLE_NAME missing");

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// ----------------------------------------------------------------------------
// Utility: Stream → String
// ----------------------------------------------------------------------------
async function streamToString(stream: Readable): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

// ----------------------------------------------------------------------------
// MAIN HANDLER
//
// Input from Step Functions:
//
// {
//    "documentId": "...",
//    "knowledgeBaseId": "...",
//    "textFileKey": "path/to/textfile.txt",
//    "fileKey": "..."
// }
// ----------------------------------------------------------------------------

export const handler = async (event: any) => {
  console.log("ChunkDocument Input:", JSON.stringify(event));

  const { documentId, knowledgeBaseId, textFileKey } = event;

  if (!documentId || !textFileKey) {
    throw new Error("Missing documentId or textFileKey in chunk-document step");
  }

  // Step 1: Download extracted text
  const text = await downloadText(textFileKey);

  // Step 2: Chunk the text
  const chunks = chunkText(text, 1500, 200); // size=1500, overlap=200 chars

  // Step 3: Upload chunks JSON
  const chunksKey = `chunks/${documentId}.json`;
  await uploadChunks(chunksKey, chunks);

  // Step 4: Update Dynamo status (optional)
  await updateStatus(documentId, "chunked");

  // Step 5: Return payload for indexer
  return {
    documentId,
    knowledgeBaseId,
    chunksKey,
    chunkCount: chunks.length,
  };
};

// ----------------------------------------------------------------------------
// DOWNLOAD TEXT
// ----------------------------------------------------------------------------
async function downloadText(key: string): Promise<string> {
  console.log("Downloading text from:", key);

  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );

  const stream = res.Body as Readable;
  return await streamToString(stream);
}

// ----------------------------------------------------------------------------
// CHUNKING ALGORITHM
// ----------------------------------------------------------------------------
//
// Simple, fast, OpenAI/Claude-compatible chunker with overlap.
//
// size = max characters per chunk
// overlap = sliding window overlap for better semantic continuity
//
// ----------------------------------------------------------------------------
function chunkText(text: string, size = 1500, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const chunk = text.slice(start, end).trim();

    if (chunk.length > 0) chunks.push(chunk);

    start += size - overlap;
  }

  return chunks;
}

// ----------------------------------------------------------------------------
// UPLOAD CHUNKS JSON
// ----------------------------------------------------------------------------
async function uploadChunks(key: string, chunks: string[]) {
  console.log("Uploading chunks to:", key);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: "application/json",
      Body: JSON.stringify({ chunks }, null, 2),
    })
  );
}

// ----------------------------------------------------------------------------
// UPDATE DOCUMENT STATUS
// ----------------------------------------------------------------------------
async function updateStatus(documentId: string, status: string) {
  console.log("Updating doc status →", status);

  await ddb.send(
    new UpdateCommand({
      TableName: DB_TABLE,
      Key: {
        PK: "DOCUMENT_PK",
        SK: `DOC#${documentId}`,
      },
      UpdateExpression: "SET indexStatus = :s, updatedAt = :u",
      ExpressionAttributeValues: {
        ":s": status,
        ":u": new Date().toISOString(),
      },
    })
  );
}
