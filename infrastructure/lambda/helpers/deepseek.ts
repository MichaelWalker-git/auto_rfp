/**
 * DeepSeek Integration Helper
 *
 * Provides utilities for calling the DeepSeek ECS OCR service.
 * The service runs on ECS with GPU instances (g4dn.xlarge) behind an ALB.
 *
 * API Contract (from aws-samples/sample-deepseek-ocr-selfhost):
 * - Health: GET http://{ALB_URL}/health
 * - Image OCR: POST http://{ALB_URL}/ocr/image (multipart/form-data)
 * - PDF OCR: POST http://{ALB_URL}/ocr/pdf (multipart/form-data)
 * - Batch: POST http://{ALB_URL}/ocr/batch (multipart/form-data)
 *
 * IMPORTANT: The prompt MUST include '<image>' placeholder for the model to work.
 * Default prompt is just '<image>' which tells the model to OCR the image.
 *
 * Multipart Form Fields:
 * - file: The document file (required)
 * - prompt: Extraction prompt, must include '<image>' (optional, default: '<image>')
 * - grounded: boolean (optional, default: false)
 * - temperature: float 0.0-1.0 (optional, default: 0.1)
 * - top_p: float 0.0-1.0 (optional, default: 0.95)
 * - max_tokens: int (optional, default: 4096)
 */

export interface DeepSeekOCROptions {
  prompt?: string;       // Must include '<image>' placeholder
  grounded?: boolean;    // Whether to use grounded extraction
  temperature?: number;  // 0.0-1.0, default 0.1
  topP?: number;         // 0.0-1.0, default 0.95
  maxTokens?: number;    // Max output tokens
}

export interface DeepSeekImageResponse {
  success: boolean;
  result?: string;       // Extracted text/markdown
  error?: string;        // Error message if failed
}

export interface DeepSeekPDFResponse {
  success: boolean;
  results?: Array<{
    success: boolean;
    result?: string;
    error?: string;
    page_count: number;
  }>;
  total_pages?: number;
  filename?: string;
  error?: string;
}

export interface DeepSeekHealthResponse {
  status: string;
  gpu_available?: boolean;
  model_loaded?: boolean;
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
 * Default OCR prompt - includes required '<image>' placeholder
 */
export const DEFAULT_OCR_PROMPT = `<image>
Extract all text from this document verbatim.
Preserve the structure and formatting where possible.
For tables, convert them to markdown table format.
For lists, preserve the list structure.
Include all headings, paragraphs, and special sections.`;

/**
 * Get the base URL for the DeepSeek service
 */
function getBaseUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `http://${endpoint}`;
}

/**
 * Extract text from an image using DeepSeek OCR service
 *
 * @param endpoint - The DeepSeek ALB endpoint URL
 * @param fileBuffer - Raw file buffer (PNG, JPEG, etc.)
 * @param filename - Original filename for MIME type detection
 * @param options - Optional extraction parameters
 * @param requestId - Optional request ID for logging
 */
export async function extractTextFromImage(
  endpoint: string,
  fileBuffer: Buffer,
  filename: string,
  options: DeepSeekOCROptions = {},
  requestId?: string
): Promise<DeepSeekImageResponse> {
  const startTime = Date.now();
  const baseUrl = getBaseUrl(endpoint);
  const url = `${baseUrl}/ocr/image`;

  console.log(`[DeepSeek] Calling ${url}`, requestId ? `(request: ${requestId})` : '');

  // Build multipart form data
  const formData = new FormData();

  // Add the file (convert Buffer to Uint8Array for Blob compatibility)
  const mimeType = inferMimeType(filename);
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  formData.append('file', blob, filename);

  // Add optional parameters
  const prompt = options.prompt || DEFAULT_OCR_PROMPT;
  formData.append('prompt', prompt);

  if (options.grounded !== undefined) {
    formData.append('grounded', String(options.grounded));
  }
  if (options.temperature !== undefined) {
    formData.append('temperature', String(options.temperature));
  }
  if (options.topP !== undefined) {
    formData.append('top_p', String(options.topP));
  }
  if (options.maxTokens !== undefined) {
    formData.append('max_tokens', String(options.maxTokens));
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      body: formData,
      headers: requestId ? { 'X-Request-Id': requestId } : undefined,
    },
    300000 // 5 minute timeout
  );

  const elapsed = Date.now() - startTime;
  console.log(`[DeepSeek] Response received in ${elapsed}ms, status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new DeepSeekExtractionError(
      `DeepSeek image extraction failed: ${response.status}`,
      response.status,
      errorText
    );
  }

  const result: DeepSeekImageResponse = await response.json();

  if (!result.success) {
    throw new DeepSeekExtractionError(
      result.error || 'DeepSeek extraction returned success=false',
      500,
      result.error
    );
  }

  console.log(`[DeepSeek] Image extraction successful, result length: ${result.result?.length || 0} chars`);

  return result;
}

/**
 * Extract text from a PDF using DeepSeek OCR service
 *
 * NOTE: As of testing, the /ocr/pdf endpoint may have issues with some PDFs.
 * Consider using extractTextFromImage with PDF-to-image conversion as a fallback.
 *
 * @param endpoint - The DeepSeek ALB endpoint URL
 * @param fileBuffer - Raw PDF file buffer
 * @param filename - Original filename
 * @param options - Optional extraction parameters
 * @param requestId - Optional request ID for logging
 */
export async function extractTextFromPDF(
  endpoint: string,
  fileBuffer: Buffer,
  filename: string,
  options: DeepSeekOCROptions = {},
  requestId?: string
): Promise<DeepSeekPDFResponse> {
  const startTime = Date.now();
  const baseUrl = getBaseUrl(endpoint);
  const url = `${baseUrl}/ocr/pdf`;

  console.log(`[DeepSeek] Calling ${url}`, requestId ? `(request: ${requestId})` : '');

  // Build multipart form data
  const formData = new FormData();

  // Add the file (convert Buffer to Uint8Array for Blob compatibility)
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' });
  formData.append('file', blob, filename);

  // Add optional parameters
  const prompt = options.prompt || DEFAULT_OCR_PROMPT;
  formData.append('prompt', prompt);

  if (options.grounded !== undefined) {
    formData.append('grounded', String(options.grounded));
  }
  if (options.temperature !== undefined) {
    formData.append('temperature', String(options.temperature));
  }
  if (options.topP !== undefined) {
    formData.append('top_p', String(options.topP));
  }
  if (options.maxTokens !== undefined) {
    formData.append('max_tokens', String(options.maxTokens));
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      body: formData,
      headers: requestId ? { 'X-Request-Id': requestId } : undefined,
    },
    600000 // 10 minute timeout for PDFs (can be multi-page)
  );

  const elapsed = Date.now() - startTime;
  console.log(`[DeepSeek] Response received in ${elapsed}ms, status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new DeepSeekExtractionError(
      `DeepSeek PDF extraction failed: ${response.status}`,
      response.status,
      errorText
    );
  }

  const result: DeepSeekPDFResponse = await response.json();

  if (!result.success) {
    throw new DeepSeekExtractionError(
      result.error || 'DeepSeek PDF extraction returned success=false',
      500,
      result.error
    );
  }

  // Combine all page results for logging
  const totalChars = result.results?.reduce((sum, r) => sum + (r.result?.length || 0), 0) || 0;
  console.log(`[DeepSeek] PDF extraction successful, ${result.total_pages} pages, ${totalChars} chars total`);

  return result;
}

/**
 * Extract text from a document, automatically selecting the right endpoint
 *
 * @param endpoint - The DeepSeek ALB endpoint URL
 * @param fileBuffer - Raw file buffer
 * @param filename - Original filename for type detection
 * @param options - Optional extraction parameters
 * @param requestId - Optional request ID for logging
 */
export async function extractTextWithDeepSeek(
  endpoint: string,
  fileBuffer: Buffer,
  filename: string,
  options: DeepSeekOCROptions = {},
  requestId?: string
): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'pdf') {
    const response = await extractTextFromPDF(endpoint, fileBuffer, filename, options, requestId);

    // Combine all page results into a single string
    if (response.results) {
      return response.results
        .filter((r) => r.success && r.result)
        .map((r) => r.result)
        .join('\n\n--- Page Break ---\n\n');
    }

    return '';
  }

  // For images
  const response = await extractTextFromImage(endpoint, fileBuffer, filename, options, requestId);
  return response.result || '';
}

/**
 * Check DeepSeek service health
 */
export async function checkDeepSeekHealth(endpoint: string): Promise<boolean> {
  const baseUrl = getBaseUrl(endpoint);
  const url = `${baseUrl}/health`;

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
