export class ApiError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, public details?: any) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthorizationError extends ApiError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'AuthorizationError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ExternalServiceError extends ApiError {
  constructor(message: string, public service: string) {
    super(message, 502, 'EXTERNAL_SERVICE_ERROR');
    this.name = 'ExternalServiceError';
  }
}

/**
 * Generic cloud connection error
 * For ICloudClient / ICloudConnectionService / cloud-based document providers.
 */
export class CloudConnectionError extends ExternalServiceError {
  constructor(
    message: string = 'Cloud service connection failed',
    service: string = 'CloudDocuments'
  ) {
    super(message, service);
    this.name = 'CloudConnectionError';
  }
}

/**
 * Backwards-compat: specific error for LlamaCloud.
 * Still available but now built on top of CloudConnectionError.
 */
export class LlamaCloudConnectionError extends CloudConnectionError {
  constructor(message: string = 'LlamaCloud connection failed') {
    super(message, 'LlamaCloud');
    this.name = 'LlamaCloudConnectionError';
  }
}

/**
 * Error thrown when AI service operations fail
 * (Bedrock, OpenAI, etc. – generic)
 */
export class AIServiceError extends ApiError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode, 'AI_SERVICE_ERROR');
    this.name = 'AIServiceError';
  }
}

/**
 * Error for index / RAG service operations (e.g. IAwsIndexService)
 */
export class IndexServiceError extends ApiError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode, 'INDEX_SERVICE_ERROR');
    this.name = 'IndexServiceError';
  }
}

/**
 * Bedrock-specific connection issues
 */
export class BedrockConnectionError extends ExternalServiceError {
  constructor(message: string = 'Bedrock connection failed') {
    super(message, 'Bedrock');
    this.name = 'BedrockConnectionError';
  }
}

/**
 * Bedrock model invocation / runtime errors
 */
export class BedrockInvocationError extends ExternalServiceError {
  constructor(message: string = 'Bedrock model invocation failed') {
    super(message, 'Bedrock');
    this.name = 'BedrockInvocationError';
  }
}

/**
 * S3-specific storage errors (used by S3-based document services)
 */
export class S3StorageError extends ExternalServiceError {
  constructor(message: string = 'S3 storage operation failed') {
    super(message, 'S3');
    this.name = 'S3StorageError';
  }
}

/**
 * Error thrown when document storage operations fail
 * (S3 + DB, etc. – for IParsedDocumentStore / IAwsDocumentStore)
 */
export class DocumentStoreError extends ApiError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode, 'DOCUMENT_STORE_ERROR');
    this.name = 'DocumentStoreError';
  }
}

/**
 * Error thrown for parsing pipeline issues
 * (IParseClient / IParseProcessingService – Textract, LlamaParse, etc.)
 */
export class ParseServiceError extends ApiError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode, 'PARSE_SERVICE_ERROR');
    this.name = 'ParseServiceError';
  }
}

/**
 * Error thrown when database operations fail
 */
export class DatabaseError extends ApiError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

/**
 * Configuration-related errors
 */
export class ConfigurationError extends ApiError {
  constructor(message: string) {
    super(message, 500, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

/**
 * Narrowing helper
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
