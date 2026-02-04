/**
 * DeepSeek Integration Helper
 *
 * Provides utilities for calling the existing DeepSeek ECS OCR service.
 * The service runs on ECS with GPU instances (g4dn.xlarge) behind an internal ALB.
 *
 * API Contract (from idp-human-validation):
 * - Endpoint: POST http://{ALB_URL}/process
 * - Health: GET http://{ALB_URL}/health
 */

export interface DeepSeekExtractionRequest {
  imageBase64: string;  // base64 encoded document (PDF, PNG, JPEG, etc.)
  prompt: string;       // OCR extraction prompt
  grounded?: boolean;   // Whether to use grounded extraction
  temperature?: number; // 0.0-1.0, default 0.1
  top_p?: number;       // 0.0-1.0, default 0.95
  max_tokens?: number;  // Max output tokens, default 80000 for OCR
}

export interface DeepSeekExtractionResponse {
  success: boolean;
  result?: string;      // Extracted text/markdown
  error?: string;       // Error message if failed
}

export interface DeepSeekHealthResponse {
  status: 'healthy' | 'unhealthy';
}

/**
 * Feature flag to determine which extraction method to use
 */
export function shouldUseDeepSeek(): boolean {
  return process.env.USE_DEEPSEEK === 'true';
}

/**
 * Get the percentage of traffic to route to DeepSeek (0-100)
 * Used for gradual rollout
 */
export function getDeepSeekTrafficPercentage(): number {
  const percentage = parseInt(process.env.DEEPSEEK_TRAFFIC_PERCENT || '0', 10);
  if (isNaN(percentage)) {
    return 0;
  }
  return Math.max(0, Math.min(100, percentage));
}

/**
 * Determine if this request should use DeepSeek based on traffic percentage
 * Uses deterministic hashing for consistent routing
 */
export function shouldRouteToDeepSeek(documentId: string): boolean {
  if (!shouldUseDeepSeek()) {
    return false;
  }

  const percentage = getDeepSeekTrafficPercentage();
  if (percentage === 0) {
    return false;
  }
  if (percentage === 100) {
    return true;
  }

  // Deterministic routing based on document ID hash
  const hash = simpleHash(documentId);
  return (hash % 100) < percentage;
}

/**
 * Simple string hash for deterministic routing
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Default OCR prompt for document text extraction
 */
export const DEFAULT_OCR_PROMPT = `Extract all text from this document.
Preserve the structure and formatting where possible.
For tables, convert them to markdown table format.
For lists, preserve the list structure.
Include all headings, paragraphs, and special sections.`;

/**
 * Call DeepSeek OCR service to extract text from a document
 *
 * @param endpoint - The DeepSeek ALB endpoint URL (e.g., "internal-deepseek-alb-123.us-east-1.elb.amazonaws.com")
 * @param documentBase64 - Base64 encoded document content
 * @param options - Optional extraction parameters
 * @param requestId - Optional request ID for logging
 */
export async function extractTextWithDeepSeek(
  endpoint: string,
  documentBase64: string,
  options: {
    prompt?: string;
    grounded?: boolean;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  } = {},
  requestId?: string
): Promise<DeepSeekExtractionResponse> {
  const startTime = Date.now();

  const request: DeepSeekExtractionRequest = {
    imageBase64: documentBase64,
    prompt: options.prompt || DEFAULT_OCR_PROMPT,
    grounded: options.grounded ?? false,
    temperature: options.temperature ?? 0.1,
    top_p: options.topP ?? 0.95,
    max_tokens: options.maxTokens ?? 80000, // High limit for full document OCR
  };

  const url = endpoint.startsWith('http') ? `${endpoint}/process` : `http://${endpoint}/process`;

  console.log(`[DeepSeek] Calling ${url}`, requestId ? `(request: ${requestId})` : '');

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(requestId && { 'X-Request-Id': requestId }),
    },
    body: JSON.stringify(request),
  }, 300000); // 5 minute timeout

  const elapsed = Date.now() - startTime;
  console.log(`[DeepSeek] Response received in ${elapsed}ms, status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new DeepSeekExtractionError(
      `DeepSeek extraction failed: ${response.status}`,
      response.status,
      errorText
    );
  }

  const result: DeepSeekExtractionResponse = await response.json();

  if (!result.success) {
    throw new DeepSeekExtractionError(
      result.error || 'DeepSeek extraction returned success=false',
      500,
      result.error
    );
  }

  console.log(`[DeepSeek] Extraction successful, result length: ${result.result?.length || 0} chars`);

  return result;
}

/**
 * Check DeepSeek service health
 */
export async function checkDeepSeekHealth(endpoint: string): Promise<boolean> {
  const url = endpoint.startsWith('http') ? `${endpoint}/health` : `http://${endpoint}/health`;

  try {
    const response = await fetchWithTimeout(url, { method: 'GET' }, 10000);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Custom error class for DeepSeek extraction errors
 */
export class DeepSeekExtractionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'DeepSeekExtractionError';
  }

  /**
   * Check if error is retryable (5xx errors, connection errors)
   */
  isRetryable(): boolean {
    return this.statusCode >= 500 ||
      this.message.includes('ECONNREFUSED') ||
      this.message.includes('ETIMEDOUT') ||
      this.message.includes('ECONNRESET');
  }

  /**
   * Check if error is a client error (4xx)
   */
  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }
}

/**
 * Infer MIME type from file extension
 */
export function inferMimeType(fileKey: string): string {
  const ext = fileKey.toLowerCase().split('.').pop();

  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    gif: 'image/gif',
    webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
  };

  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Check if file type is supported by DeepSeek OCR
 * Supports: PDF, PNG, JPEG, GIF, WEBP
 */
export function isDeepSeekSupported(fileKey: string): boolean {
  const ext = fileKey.toLowerCase().split('.').pop();
  const supported = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'gif', 'webp'];
  return supported.includes(ext || '');
}

/**
 * Metrics for comparing Textract vs DeepSeek performance
 */
export interface ExtractionMetrics {
  method: 'deepseek' | 'textract';
  documentId: string;
  fileKey: string;
  fileSizeBytes: number;
  extractedTextLength: number;
  processingTimeMs: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Log extraction metrics for comparison analysis
 */
export function logExtractionMetrics(metrics: ExtractionMetrics): void {
  console.log('EXTRACTION_METRICS:', JSON.stringify(metrics));
}
