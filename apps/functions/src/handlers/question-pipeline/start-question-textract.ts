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
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { buildQuestionFileSK, updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';

const textract = new TextractClient({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const TEXTRACT_ROLE_ARN = requireEnv('TEXTRACT_ROLE_ARN');
const TEXTRACT_SNS_TOPIC_ARN = requireEnv('TEXTRACT_SNS_TOPIC_ARN');

/**
 * Validate file key format and extension
 * Textract only supports PDF, PNG, JPEG, TIFF
 */
function isValidFileKeyForTextract(fileKey: string): boolean {
  if (!fileKey || typeof fileKey !== 'string') {
    return false;
  }
  const lowerKey = fileKey.toLowerCase();
  return (
    lowerKey.endsWith('.pdf') ||
    lowerKey.endsWith('.png') ||
    lowerKey.endsWith('.jpg') ||
    lowerKey.endsWith('.jpeg') ||
    lowerKey.endsWith('.tiff') ||
    lowerKey.endsWith('.tif')
  );
}

/**
 * Check if error is a Textract parameter/document error (AUTO-RFP-66)
 */
function isTextractInputError(err: unknown): { isInputError: boolean; message: string } {
  if (err instanceof InvalidParameterException) {
    return { isInputError: true, message: `Invalid parameter: ${err.message}` };
  }
  if (err instanceof InvalidS3ObjectException) {
    return { isInputError: true, message: `Invalid S3 object: ${err.message}` };
  }
  if (err instanceof UnsupportedDocumentException) {
    return { isInputError: true, message: `Unsupported document type: ${err.message}` };
  }
  if (err instanceof DocumentTooLargeException) {
    return { isInputError: true, message: `Document too large for Textract: ${err.message}` };
  }
  if (err instanceof BadDocumentException) {
    return { isInputError: true, message: `Bad document format: ${err.message}` };
  }
  if (err instanceof AccessDeniedException) {
    return { isInputError: true, message: `Access denied to S3 object: ${err.message}` };
  }
  // Check for error name property for SDK v3 errors
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
}

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
  const sfnClient = new SFNClient({ region: 'us-east-1' });

  console.log('start-question-textract event:', JSON.stringify(event));

  // Validate required fields with clear error messages (AUTO-RFP-66)
  if (!questionFileId || !projectId || !opportunityId) {
    const missing: string[] = [];
    if (!questionFileId) missing.push('questionFileId');
    if (!projectId) missing.push('projectId');
    if (!opportunityId) missing.push('opportunityId');
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  // Validate taskToken is present (required for callback)
  if (!taskToken) {
    throw new Error('taskToken is required for Step Function callback');
  }

  const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
  
  if (isCancelled) {    
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({
        questionFileId,
        oppId: opportunityId,
        jobId: '',
        status: 'CANCELLED',
        cancelled: true,
      }),
    }));
    
    return { ok: true, cancelled: true };
  }

  const sk = buildQuestionFileSK(projectId, opportunityId, questionFileId);

  const { Item: item } = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      }
    })
  );

  if (!item) {
    console.log('Question file not found in DB - treating as cancelled');
    
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({
        questionFileId,
        oppId: opportunityId,
        jobId: '',
        status: 'CANCELLED',
        cancelled: true,
      }),
    }));
    
    return { ok: true, cancelled: true };
  }

  console.log(`Question file found, status: ${item.status}`);

  const fileKey = item.fileKey;
  if (!fileKey) {
    // Update status and fail the task gracefully
    await updateQuestionFile(projectId, opportunityId, questionFileId, {
      status: 'FAILED',
      errorMessage: 'Document file key is missing. Please re-upload the file.',
    });
    await sfnClient.send(new SendTaskFailureCommand({
      taskToken,
      error: 'MissingFileKey',
      cause: 'Question file record has no fileKey. The file may not have been uploaded properly.',
    }));
    return { ok: false, error: 'MissingFileKey' };
  }

  // Validate file type before calling Textract (AUTO-RFP-66)
  if (!isValidFileKeyForTextract(fileKey)) {
    const errorMessage = `Unsupported file type for text extraction. File: ${fileKey}. Supported types: PDF, PNG, JPEG, TIFF.`;
    console.error(errorMessage);
    await updateQuestionFile(projectId, opportunityId, questionFileId, {
      status: 'FAILED',
      errorMessage,
    });
    await sfnClient.send(new SendTaskFailureCommand({
      taskToken,
      error: 'UnsupportedFileType',
      cause: errorMessage,
    }));
    return { ok: false, error: 'UnsupportedFileType' };
  }

  let startRes;
  try {
    startRes = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: { Bucket: DOCUMENTS_BUCKET, Name: fileKey }
        },
        NotificationChannel: {
          RoleArn: TEXTRACT_ROLE_ARN,
          SNSTopicArn: TEXTRACT_SNS_TOPIC_ARN
        },
        JobTag: questionFileId
      })
    );
  } catch (textractErr) {
    // Handle Textract input errors gracefully (AUTO-RFP-66)
    const { isInputError, message } = isTextractInputError(textractErr);
    if (isInputError) {
      console.error(`Textract input error for ${questionFileId}:`, message);
      await updateQuestionFile(projectId, opportunityId, questionFileId, {
        status: 'FAILED',
        errorMessage: message,
      });
      await sfnClient.send(new SendTaskFailureCommand({
        taskToken,
        error: 'TextractInputError',
        cause: message,
      }));
      return { ok: false, error: 'TextractInputError', message };
    }
    // Re-throw unexpected errors
    throw textractErr;
  }

  const jobId = startRes.JobId;
  if (!jobId) {
    const errorMessage = 'Textract did not return a job ID';
    await updateQuestionFile(projectId, opportunityId, questionFileId, {
      status: 'FAILED',
      errorMessage,
    });
    await sfnClient.send(new SendTaskFailureCommand({
      taskToken,
      error: 'NoJobId',
      cause: errorMessage,
    }));
    return { ok: false, error: 'NoJobId' };
  }
  
  const updateResult = await updateQuestionFile(projectId, opportunityId, questionFileId, { 
    status: 'TEXTRACT_RUNNING', 
    jobId, 
    taskToken 
  });

  if (updateResult.deleted) {
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({
        questionFileId,
        oppId: opportunityId,
        jobId,
        status: 'CANCELLED',
        cancelled: true,
      }),
    }));
    
    return { ok: true, cancelled: true, deleted: true };
  }
  
  return { jobId } as StartTextractResp;
};

export const handler = withSentryLambda(baseHandler);
