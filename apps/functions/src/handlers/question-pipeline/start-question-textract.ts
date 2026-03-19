import {
  StartDocumentTextDetectionCommand,
  TextractClient,
  InvalidParameterException,
  InvalidS3ObjectException,
  UnsupportedDocumentException,
  DocumentTooLargeException,
  BadDocumentException,
  AccessDeniedException,
} from '@aws-sdk/client-textract';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { buildQuestionFileSK, updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

const textract = new TextractClient({});

// Resolved lazily so Lambdas without these env vars don't crash at cold-start
const getTableName = () => requireEnv('DB_TABLE_NAME');
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getTextractRoleArn = () => requireEnv('TEXTRACT_ROLE_ARN');
const getTextractSnsTopicArn = () => requireEnv('TEXTRACT_SNS_TOPIC_ARN');

/**
 * Validate file key format and extension.
 * Textract only supports PDF, PNG, JPEG, TIFF.
 */
const isValidFileKeyForTextract = (fileKey: string): boolean => {
  if (!fileKey || typeof fileKey !== 'string') return false;
  const lowerKey = fileKey.toLowerCase();
  return (
    lowerKey.endsWith('.pdf') ||
    lowerKey.endsWith('.png') ||
    lowerKey.endsWith('.jpg') ||
    lowerKey.endsWith('.jpeg') ||
    lowerKey.endsWith('.tiff') ||
    lowerKey.endsWith('.tif')
  );
};

/**
 * Check if error is a Textract parameter/document error (AUTO-RFP-66).
 */
const isTextractInputError = (err: unknown): { isInputError: boolean; message: string } => {
  if (err instanceof InvalidParameterException) return { isInputError: true, message: `Invalid parameter: ${err.message}` };
  if (err instanceof InvalidS3ObjectException) return { isInputError: true, message: `Invalid S3 object: ${err.message}` };
  if (err instanceof UnsupportedDocumentException) return { isInputError: true, message: `Unsupported document type: ${err.message}` };
  if (err instanceof DocumentTooLargeException) return { isInputError: true, message: `Document too large for Textract: ${err.message}` };
  if (err instanceof BadDocumentException) return { isInputError: true, message: `Bad document format: ${err.message}` };
  if (err instanceof AccessDeniedException) return { isInputError: true, message: `Access denied to S3 object: ${err.message}` };

  if (err && typeof err === 'object' && 'name' in err) {
    const errorName = (err as { name: string }).name;
    const errorMessage = 'message' in err ? String((err as { message: string }).message) : 'Unknown error';
    if ([
      'InvalidParameterException',
      'InvalidS3ObjectException',
      'UnsupportedDocumentException',
      'DocumentTooLargeException',
      'BadDocumentException',
      'AccessDeniedException',
    ].includes(errorName)) {
      return { isInputError: true, message: `${errorName}: ${errorMessage}` };
    }
  }
  return { isInputError: false, message: '' };
};

export interface StartTextractEvent {
  taskToken: string;
  questionFileId: string;
  projectId: string;
  opportunityId: string;
  sourceFileKey?: string;
  mimeType?: string;
}

export interface StartTextractResp {
  jobId: string;
}

export const baseHandler = async (event: StartTextractEvent) => {
  const { questionFileId, projectId, opportunityId, taskToken } = event;
  const sfnClient = new SFNClient({});

  if (!questionFileId || !projectId || !opportunityId) {
    const missing = [
      !questionFileId && 'questionFileId',
      !projectId && 'projectId',
      !opportunityId && 'opportunityId',
    ].filter(Boolean) as string[];
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  if (!taskToken) throw new Error('taskToken is required for Step Function callback');

  const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);

  if (isCancelled) {
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({ questionFileId, oppId: opportunityId, jobId: '', status: 'CANCELLED', cancelled: true }),
    }));
    return { ok: true, cancelled: true };
  }

  const sk = buildQuestionFileSK(projectId, opportunityId, questionFileId);
  const { Item: item } = await docClient.send(
    new GetCommand({ TableName: getTableName(), Key: { [PK_NAME]: QUESTION_FILE_PK, [SK_NAME]: sk } }),
  );

  if (!item) {
    console.log('Question file not found in DB — treating as cancelled');
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({ questionFileId, oppId: opportunityId, jobId: '', status: 'CANCELLED', cancelled: true }),
    }));
    return { ok: true, cancelled: true };
  }

  const fileKey = item.fileKey as string | undefined;
  if (!fileKey) {
    const errorMessage = 'Document file key is missing. Please re-upload the file.';
    await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'FAILED', errorMessage });
    await sfnClient.send(new SendTaskFailureCommand({ taskToken, error: 'MissingFileKey', cause: errorMessage }));
    return { ok: false, error: 'MissingFileKey' };
  }

  if (!isValidFileKeyForTextract(fileKey)) {
    const errorMessage = `Unsupported file type for text extraction. File: ${fileKey}. Supported types: PDF, PNG, JPEG, TIFF.`;
    console.error(errorMessage);
    await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'FAILED', errorMessage });
    await sfnClient.send(new SendTaskFailureCommand({ taskToken, error: 'UnsupportedFileType', cause: errorMessage }));
    return { ok: false, error: 'UnsupportedFileType' };
  }

  let startRes;
  try {
    startRes = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: getDocumentsBucket(), Name: fileKey } },
        NotificationChannel: { RoleArn: getTextractRoleArn(), SNSTopicArn: getTextractSnsTopicArn() },
        JobTag: questionFileId,
      }),
    );
  } catch (textractErr) {
    const { isInputError, message } = isTextractInputError(textractErr);
    if (isInputError) {
      console.error(`Textract input error for ${questionFileId}:`, message);
      await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'FAILED', errorMessage: message });
      await sfnClient.send(new SendTaskFailureCommand({ taskToken, error: 'TextractInputError', cause: message }));
      return { ok: false, error: 'TextractInputError', message };
    }
    throw textractErr;
  }

  const jobId = startRes.JobId;
  if (!jobId) {
    const errorMessage = 'Textract did not return a job ID';
    await updateQuestionFile(projectId, opportunityId, questionFileId, { status: 'FAILED', errorMessage });
    await sfnClient.send(new SendTaskFailureCommand({ taskToken, error: 'NoJobId', cause: errorMessage }));
    return { ok: false, error: 'NoJobId' };
  }

  const updateResult = await updateQuestionFile(projectId, opportunityId, questionFileId, {
    status: 'TEXTRACT_RUNNING',
    jobId,
    taskToken,
  });

  if (updateResult.deleted) {
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({ questionFileId, oppId: opportunityId, jobId, status: 'CANCELLED', cancelled: true }),
    }));
    return { ok: true, cancelled: true, deleted: true };
  }

  // Write QUESTION_PIPELINE_STARTED audit log (non-blocking per rules)
  const orgId = (item.orgId as string) || 'unknown';
  getHmacSecret().then(hmacSecret => {
    writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: 'system',
        userName: 'system',
        organizationId: orgId,
        action: 'QUESTION_PIPELINE_STARTED',
        resource: 'question_file',
        resourceId: questionFileId,
        changes: {
          after: {
            questionFileId,
            projectId,
            opportunityId,
            fileKey,
            jobId,
          },
        },
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: 'success',
      },
      hmacSecret,
    );
  }).catch(err => console.warn('Failed to write QUESTION_PIPELINE_STARTED audit log:', (err as Error)?.message));

  return { jobId } as StartTextractResp;
};

export const handler = withSentryLambda(baseHandler);
