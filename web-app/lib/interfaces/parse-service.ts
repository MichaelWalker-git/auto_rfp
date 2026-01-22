import {
  LlamaParseRequest,
  LlamaParseOptions,
  LlamaParseResult,
  LlamaParseResponse,
  FileValidation,
} from '@/lib/validators/llamaparse';

/**
 * Provider-agnostic type aliases (optional but nicer names)
 */
export type ParseRequest = LlamaParseRequest;
export type ParseOptions = LlamaParseOptions;
export type ParseResult = LlamaParseResult;
export type ParsedDocument = LlamaParseResponse;

/**
 * Interface for file validation operations
 */
export interface IFileValidator {
  /**
   * Validate file format and constraints
   */
  validateFile(file: File): Promise<FileValidation>;

  /**
   * Check if file extension is supported
   */
  isSupportedFileType(filename: string): boolean;

  /**
   * Get file extension from filename
   */
  getFileExtension(filename: string): string | null;
}

/**
 * Generic interface for parsing client operations
 * (implementation may be LlamaParse, AWS Textract, etc.)
 */
export interface IParseClient {
  /**
   * Check if underlying parsing service is properly configured
   */
  isConfigured(): boolean;

  /**
   * Parse a file using the underlying parsing service
   */
  parseFile(file: File, options: ParseOptions): Promise<ParseResult>;
}

/**
 * Interface for parsed document storage operations
 * (e.g. S3 + DB, local, etc.)
 */
export interface IParsedDocumentStore {
  /**
   * Store a parsed document
   */
  addDocument(document: ParsedDocument): Promise<void>;

  /**
   * Get document by ID
   */
  getDocument(documentId: string): Promise<ParsedDocument | null>;

  /**
   * Get document statistics
   */
  getStats(): Promise<{
    totalDocuments: number;
    lastProcessed: Date | null;
  }>;
}

/**
 * Interface for end-to-end parsing / processing service
 * (validate → parse → store → return)
 */
export interface IParseProcessingService {
  /**
   * Process file upload and parsing
   */
  processFile(request: ParseRequest): Promise<ParsedDocument>;
}

/**
 * Configuration for generic parsing service
 */
export interface ParseServiceConfig {
  maxFileSize: number;
  supportedMimeTypes: string[];
  defaultTimeout: number;
}

/**
 * --- Backwards-compatibility aliases (optional) ---
 * Remove once all usages are migrated to generic names.
 */

export interface ILlamaParseClient extends IParseClient {}
export interface IDocumentStore extends IParsedDocumentStore {}
export interface ILlamaParseProcessingService extends IParseProcessingService {}
export type LlamaParseServiceConfig = ParseServiceConfig;
