import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetDocumentTextDetectionCommand, TextractClient } from '@aws-sdk/client-textract';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

// --------------------------------------------------
// Clients
// --------------------------------------------------
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const textract = new TextractClient({});
const s3 = new S3Client({});

// --------------------------------------------------
// Env
// --------------------------------------------------
const TABLE = process.env.DB_TABLE_NAME!;
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;
if (!TABLE) throw new Error("DB_TABLE_NAME env not set");
if (!BUCKET) throw new Error("DOCUMENTS_BUCKET_NAME env not set");

// --------------------------------------------------
// Types
// --------------------------------------------------
interface Event {
  questionFileId?: string;
  projectId?: string;
  jobId?: string;
}

interface TextractResult {
  text: string;
  status: string;
}

// --------------------------------------------------
// Main Handler
// --------------------------------------------------
export const handler = async (
  event: Event,
  _ctx: Context
): Promise<{ questionFileId: string; projectId: string; textFileKey: string }> => {
  console.log("process-question-file event:", JSON.stringify(event));

  const { questionFileId, projectId, jobId } = event;

  if (!questionFileId || !projectId || !jobId) {
    throw new Error("questionFileId, projectId, jobId are required");
  }

  // 1) Run Textract pagination
  const { text, status } = await getTextractText(jobId);

  if (status !== "SUCCEEDED") {
    await updateStatus(questionFileId, projectId, "error");
    throw new Error(`Textract job failed: status=${status}`);
  }

  // 2) Save the full extracted text to S3
  const textFileKey = `${jobId}/${projectId}/${questionFileId}.txt`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: textFileKey,
      Body: text,
      ContentType: "text/plain; charset=utf-8"
    })
  );

  // 3) Update question_file record
  await updateStatus(questionFileId, projectId, "text_ready", textFileKey);

  return { questionFileId, projectId, textFileKey };
};

// --------------------------------------------------
// Textract Pagination Helper
// --------------------------------------------------
async function getTextractText(jobId: string): Promise<TextractResult> {
  let nextToken: string | undefined;
  const lines: string[] = [];
  let jobStatus: string | undefined;

  do {
    const res: any = await textract.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken
      })
    );

    jobStatus = res.JobStatus;
    if (!jobStatus) return { text: "", status: "UNKNOWN" };
    if (jobStatus !== "SUCCEEDED")
      return { text: "", status: jobStatus };

    if (Array.isArray(res.Blocks)) {
      for (const block of res.Blocks) {
        if (block.BlockType === "LINE" && block.Text) {
          lines.push(block.Text);
        }
      }
    }

    nextToken = res.NextToken;
  } while (nextToken);

  return {
    text: lines.join("\n"),
    status: jobStatus
  };
}

// --------------------------------------------------
// DynamoDB Update Helper
// --------------------------------------------------
async function updateStatus(
  questionFileId: string,
  projectId: string,
  status: "processing" | "text_ready" | "questions_extracted" | "error",
  textFileKey?: string
) {
  const sk = `${projectId}#${questionFileId}`;

  const fields: string[] = ["#status = :status", "#updatedAt = :now"];
  const names: Record<string, string> = {
    "#status": "status",
    "#updatedAt": "updatedAt"
  };
  const values: Record<string, any> = {
    ":status": status,
    ":now": new Date().toISOString()
  };

  if (textFileKey) {
    fields.push("#textFileKey = :key");
    names["#textFileKey"] = "textFileKey";
    values[":key"] = textFileKey;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      },
      UpdateExpression: "SET " + fields.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    })
  );
}
