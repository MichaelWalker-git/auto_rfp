import { 
  LlamaParseRequest, 
  LlamaParseOptions, 
  LlamaParseResult, 
  LlamaParseResponse,
  FileValidation 
} from '@/lib/validators/llamaparse';

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
 * Interface for LlamaParse client operations
 */
export interface ILlamaParseClient {
  /**
   * Check if LlamaParse service is properly configured
   */
  isConfigured(): boolean;
  
  /**
   * Parse a file using LlamaParse service
   */
  parseFile(file: File, options: LlamaParseOptions): Promise<LlamaParseResult>;
}

/**
 * Interface for document storage operations
 */
export interface IDocumentStore {
  /**
   * Store a parsed document
   */
  addDocument(document: LlamaParseResponse): Promise<void>;
  
  /**
   * Get document by ID
   */
  getDocument(documentId: string): Promise<LlamaParseResponse | null>;
  
  /**
   * Get document statistics
   */
  getStats(): Promise<{
    totalDocuments: number;
    lastProcessed: Date | null;
  }>;
}

/**
 * Interface for LlamaParse processing service
 */
export interface ILlamaParseProcessingService {
  /**
   * Process file upload and parsing
   */
  processFile(request: LlamaParseRequest): Promise<LlamaParseResponse>;
}

/**
 * Configuration for LlamaParse service
 */
export interface LlamaParseServiceConfig {
  maxFileSize: number;
  supportedMimeTypes: string[];
  defaultTimeout: number;
} 