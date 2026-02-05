/**
 * DeepSeek Text Extraction Lambda
 *
 * Extracts text from documents using the existing DeepSeek OCR service
 * running on ECS in the idp-human-validation infrastructure.
 *
 * This Lambda provides synchronous text extraction, replacing the async
 * Textract + SNS callback pattern for simpler, more reliable processing.
 *
 * Environment Variables:
 * - DEEPSEEK_ENDPOINT: ALB endpoint for DeepSeek service (required when USE_DEEPSEEK=true)
 * - USE_DEEPSEEK: Feature flag to enable DeepSeek (default: false)
 * - DEEPSEEK_TRAFFIC_PERCENT: Percentage of traffic to route to DeepSeek (0-100)
 * - DOCUMENTS_BUCKET: S3 bucket for documents
 */

import { Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import {
  extractTextWithDeepSeek,
  isDeepSeekSupported,
  logExtractionMetrics,
  DEFAULT_OCR_PROMPT,
} from '../helpers/deepseek';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DEEPSEEK_ENDPOINT = process.env.DEEPSEEK_ENDPOINT || '';

const s3 = new S3Client({});

export interface ExtractTextEvent {
  bucket?: string;
  key: string;
  documentId?: string;
  questionFileId?: string;
  projectId?: string;
  knowledgeBaseId?: string;
  opportunityId?: string;
  prompt?: string;
}

export interface ExtractTextResult {
  success: boolean;
  text: string;
  textFileKey: string;
  textLength: number;
  processingTimeMs: number;
}

/**
 * Extract text from a document using DeepSeek OCR service
 */
export const baseHandler = async (
  event: ExtractTextEvent,
  ctx: Context
): Promise<ExtractTextResult> => {
  console.log('extract-text-deepseek event:', JSON.stringify(event));

  const { key, documentId, questionFileId, projectId, prompt } = event;
  const bucket = event.bucket || DOCUMENTS_BUCKET;

  // Validate required fields
  if (!key) {
    throw new Error('Missing required field: key');
  }

  const entityId = documentId || questionFileId;
  if (!entityId) {
    throw new Error('Missing required field: documentId or questionFileId');
  }

  // Validate endpoint is configured
  if (!DEEPSEEK_ENDPOINT) {
    throw new Error(
      'DEEPSEEK_ENDPOINT environment variable is required for DeepSeek extraction'
    );
  }

  // Validate file type
  if (!isDeepSeekSupported(key)) {
    throw new Error(
      `Unsupported file type for DeepSeek OCR: ${key}. Supported types: PDF, PNG, JPEG, TIFF, GIF, WEBP`
    );
  }

  const startTime = Date.now();

  try {
    // Download document from S3
    console.log(`Downloading document from s3://${bucket}/${key}`);
    const { Body, ContentLength } = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    if (!Body) {
      throw new Error(`Empty document at s3://${bucket}/${key}`);
    }

    const documentBytes = await Body.transformToByteArray();
    console.log(`Document downloaded: ${ContentLength} bytes`);

    // Convert to base64
    const base64Doc = Buffer.from(documentBytes).toString('base64');

    // Call DeepSeek service
    const result = await extractTextWithDeepSeek(
      DEEPSEEK_ENDPOINT,
      base64Doc,
      { prompt: prompt || DEFAULT_OCR_PROMPT },
      ctx.awsRequestId
    );

    const text = result.result || '';
    const processingTimeMs = Date.now() - startTime;

    // Generate output text file key
    const textFileKey = generateTextFileKey(key, entityId, projectId);

    // Save extracted text to S3
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: textFileKey,
        Body: text,
        ContentType: 'text/plain; charset=utf-8',
      })
    );

    console.log(`Text saved to s3://${bucket}/${textFileKey}, length: ${text.length} chars`);

    // Log metrics for monitoring
    logExtractionMetrics({
      method: 'deepseek',
      documentId: entityId,
      fileKey: key,
      fileSizeBytes: ContentLength || 0,
      extractedTextLength: text.length,
      processingTimeMs,
      success: true,
    });

    return {
      success: true,
      text,
      textFileKey,
      textLength: text.length,
      processingTimeMs,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('DeepSeek extraction failed:', errorMessage);

    // Log failure metrics
    logExtractionMetrics({
      method: 'deepseek',
      documentId: entityId,
      fileKey: key,
      fileSizeBytes: 0,
      extractedTextLength: 0,
      processingTimeMs,
      success: false,
      errorMessage,
    });

    throw error;
  }
};

/**
 * Generate text file key for storing extracted text
 */
function generateTextFileKey(
  originalKey: string,
  entityId: string,
  projectId?: string
): string {
  const prefix = projectId ? `${projectId}/${entityId}` : entityId;
  const baseName = originalKey.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'document';
  return `extracted-text/${prefix}/${baseName}.txt`;
}

export const handler = withSentryLambda(baseHandler);
