import { StartDocumentTextDetectionCommand, TextractClient } from '@aws-sdk/client-textract';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

const textract = new TextractClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const TABLE = process.env.DB_TABLE_NAME!;
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;
const TEXTRACT_ROLE_ARN = process.env.TEXTRACT_ROLE_ARN!;
const TEXTRACT_SNS_TOPIC_ARN = process.env.TEXTRACT_SNS_TOPIC_ARN!;



interface StartEvent {
  questionFileId: string;
  projectId: string;
  taskToken?: string;
}

export const handler = async (event: StartEvent) => {
  const { questionFileId, projectId, taskToken } = event;

  if (!questionFileId || !projectId)
    throw new Error("questionFileId and projectId required");

  const sk = `${projectId}#${questionFileId}`;

  // load fileKey
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      }
    })
  );

  const item = res.Item;
  if (!item) throw new Error("question_file not found");

  const fileKey = item.fileKey;
  if (!fileKey) throw new Error("fileKey missing");

  const startRes = await textract.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: { Bucket: BUCKET, Name: fileKey }
      },
      NotificationChannel: {
        RoleArn: TEXTRACT_ROLE_ARN,
        SNSTopicArn: TEXTRACT_SNS_TOPIC_ARN
      },
      JobTag: questionFileId
    })
  );

  const jobId = startRes.JobId!;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      },
      UpdateExpression: "SET #jobId = :j, #status = :s, #taskToken = :taskToken",
      ExpressionAttributeNames: {
        "#jobId": "jobId",
        "#status": "status",
        "#taskToken": "taskToken",
      },
      ExpressionAttributeValues: {
        ":j": jobId,
        ":s": "textract_running",
        ":taskToken": taskToken,
      }
    })
  );

  return { jobId };
};
