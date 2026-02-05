/**
 * DeepSeek Text Extraction Lambda
 *
 * Handles text extraction using the DeepSeek OCR service running on ECS.
 * This Lambda is called synchronously (unlike Textract which is async).
 *
 * Strategy:
 * - For images (PNG, JPEG, etc.): Use DeepSeek /ocr/image endpoint
 * - For PDFs: Currently falling back to Textract due to service-side issues
 *   with the /ocr/pdf endpoint. Once fixed, PDFs can use DeepSeek too.
 */

import { Context } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient, getItem } from '../helpers/db';
import { nowIso } from '../helpers/date';
import { buildDocumentSK } from '../helpers/document';
import {
  extractTextFromImage,
  extractTextFromPDF,
  isDeepSeekSupported,
  logExtractionMetrics,
  DeepSeekExtractionError,
} from '../helpers/deepseek';

const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DEEPSEEK_ENDPOINT = requireEnv('DEEPSEEK_ENDPOINT');

const s3Client = new S3Client({ region: REGION });

interface DeepSeekProcessingEvent {
  orgId: string;
  documentId: string;
  knowledgeBaseId: string;
}

interface DeepSeekProcessingResult {
  documentId: string;
  knowledgeBaseId: string;
  status: 'TEXT_EXTRACTED' | 'USE_TEXTRACT_FALLBACK';
  bucket?: string;
  txtKey?: string;
  textLength?: number;
  fallbackReason?: string;
}

function buildTxtKeyNextToOriginal(originalKey: string): string {
  const clean = originalKey.split('?')[0] ?? originalKey;
  const idx = clean.lastIndexOf('.');
  if (idx === -1) return `${clean}.txt`;
  return `${clean.slice(0, idx)}.txt`;
}

function getFileExtension(fileKey: string): string {
  const ext = fileKey.toLowerCase().split('.').pop();
  return ext || '';
}

function isImageFile(fileKey: string): boolean {
  const ext = getFileExtension(fileKey);
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'tif'].includes(ext);
}

function isPdfFile(fileKey: string): boolean {
  return getFileExtension(fileKey) === 'pdf';
}

export const baseHandler = async (
  event: DeepSeekProcessingEvent,
  _context: Context
): Promise<DeepSeekProcessingResult> => {
  console.log('deepseek-processing event:', JSON.stringify(event));
  const startTime = Date.now();

  const { documentId, orgId, knowledgeBaseId } = event;
  if (!documentId || !orgId || !knowledgeBaseId) {
    throw new Error('documentId, orgId, and knowledgeBaseId are required');
  }

  // 1) Get document from DynamoDB
  const docItem = await getItem<DocumentItem>(
    DOCUMENT_PK,
    buildDocumentSK(knowledgeBaseId, documentId)
  );
  if (!docItem) {
    throw new Error(`Document not found for documentId=${documentId}`);
  }

  const fileKey = docItem?.fileKey;
  if (!fileKey) {
    throw new Error(`Document ${documentId} has no fileKey`);
  }

  // 2) Check if file type is supported
  if (!isDeepSeekSupported(fileKey)) {
    console.log(`File type not supported by DeepSeek: ${fileKey}, falling back to Textract`);
    return {
      documentId,
      knowledgeBaseId,
      status: 'USE_TEXTRACT_FALLBACK',
      fallbackReason: 'Unsupported file type',
    };
  }

  // 3) For PDFs, use Textract for now (DeepSeek /ocr/pdf has issues)
  if (isPdfFile(fileKey)) {
    console.log(`PDF detected: ${fileKey}, falling back to Textract (DeepSeek /ocr/pdf has issues)`);
    return {
      documentId,
      knowledgeBaseId,
      status: 'USE_TEXTRACT_FALLBACK',
      fallbackReason: 'PDF requires Textract (DeepSeek PDF endpoint issues)',
    };
  }

  // 4) Update status to processing
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
      },
      UpdateExpression: 'SET #indexStatus = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#indexStatus': 'indexStatus',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'DEEPSEEK_PROCESSING',
        ':updatedAt': nowIso(),
      },
    })
  );

  try {
    // 5) Download file from S3
    console.log(`Downloading file from S3: ${DOCUMENTS_BUCKET}/${fileKey}`);
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: fileKey,
      })
    );

    if (!s3Response.Body) {
      throw new Error('S3 response has no body');
    }

    const fileBuffer = Buffer.from(await s3Response.Body.transformToByteArray());
    const fileSizeBytes = fileBuffer.length;
    console.log(`Downloaded ${fileSizeBytes} bytes`);

    // 6) Extract text with DeepSeek
    let extractedText: string;
    const filename = fileKey.split('/').pop() || fileKey;

    if (isImageFile(fileKey)) {
      console.log(`Extracting text from image: ${filename}`);
      const response = await extractTextFromImage(
        DEEPSEEK_ENDPOINT,
        fileBuffer,
        filename,
        { maxTokens: 80000 },
        documentId
      );
      extractedText = response.result || '';
    } else {
      // For other supported types, try PDF endpoint (with fallback)
      console.log(`Extracting text from PDF: ${filename}`);
      const response = await extractTextFromPDF(
        DEEPSEEK_ENDPOINT,
        fileBuffer,
        filename,
        { maxTokens: 80000 },
        documentId
      );

      if (response.results) {
        extractedText = response.results
          .filter((r) => r.success && r.result)
          .map((r) => r.result)
          .join('\n\n--- Page Break ---\n\n');
      } else {
        extractedText = '';
      }
    }

    const processingTimeMs = Date.now() - startTime;

    // Log metrics
    logExtractionMetrics({
      method: 'deepseek',
      documentId,
      fileKey,
      fileSizeBytes,
      extractedTextLength: extractedText.length,
      processingTimeMs,
      success: true,
    });

    if (!extractedText.trim()) {
      console.warn('DeepSeek returned empty text');

      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: DOCUMENT_PK,
            [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
          },
          UpdateExpression: 'SET #indexStatus = :status, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#indexStatus': 'indexStatus',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':status': 'TEXT_EXTRACTION_EMPTY',
            ':updatedAt': nowIso(),
          },
        })
      );

      return {
        documentId,
        knowledgeBaseId,
        status: 'USE_TEXTRACT_FALLBACK',
        fallbackReason: 'DeepSeek returned empty text',
      };
    }

    // 7) Save extracted text to S3
    const txtKey = buildTxtKeyNextToOriginal(fileKey);
    console.log(`Saving extracted text to S3: ${DOCUMENTS_BUCKET}/${txtKey}`);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: txtKey,
        Body: Buffer.from(extractedText, 'utf-8'),
        ContentType: 'text/plain; charset=utf-8',
      })
    );

    // 8) Update document status
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: DOCUMENT_PK,
          [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
        },
        UpdateExpression:
          'SET #indexStatus = :status, #textFileKey = :txtKey, #extractionMethod = :method, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#indexStatus': 'indexStatus',
          '#textFileKey': 'textFileKey',
          '#extractionMethod': 'extractionMethod',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':status': 'TEXT_EXTRACTED',
          ':txtKey': txtKey,
          ':method': 'deepseek',
          ':updatedAt': nowIso(),
        },
      })
    );

    console.log(
      `✅ DeepSeek extraction complete for ${documentId}: ${extractedText.length} chars in ${processingTimeMs}ms`
    );

    return {
      documentId,
      knowledgeBaseId,
      status: 'TEXT_EXTRACTED',
      bucket: DOCUMENTS_BUCKET,
      txtKey,
      textLength: extractedText.length,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error('DeepSeek extraction failed:', error);

    // Log failure metrics
    logExtractionMetrics({
      method: 'deepseek',
      documentId,
      fileKey,
      fileSizeBytes: 0,
      extractedTextLength: 0,
      processingTimeMs,
      success: false,
      errorMessage,
    });

    // Update status
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: DOCUMENT_PK,
          [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
        },
        UpdateExpression: 'SET #indexStatus = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#indexStatus': 'indexStatus',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':status': 'DEEPSEEK_FAILED',
          ':updatedAt': nowIso(),
        },
      })
    );

    // For retryable errors, could implement retry logic
    // For now, fall back to Textract
    if (error instanceof DeepSeekExtractionError && error.isRetryable()) {
      console.log('DeepSeek error is retryable, falling back to Textract');
    }

    return {
      documentId,
      knowledgeBaseId,
      status: 'USE_TEXTRACT_FALLBACK',
      fallbackReason: `DeepSeek failed: ${errorMessage}`,
    };
  }
};

export const handler = withSentryLambda(baseHandler);
