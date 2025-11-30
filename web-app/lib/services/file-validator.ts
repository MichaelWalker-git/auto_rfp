import { ValidationError } from '@/lib/errors/api-errors';
import { IFileValidator, ParseServiceConfig } from '@/lib/interfaces/parse-service';
import { FileValidation, FileValidationSchema, SUPPORTED_FILE_EXTENSIONS } from '@/lib/validators/document-parse';

/**
 * File validation service implementation
 */
export class FileValidator implements IFileValidator {
  private config: ParseServiceConfig;

  constructor(config: Partial<ParseServiceConfig> = {}) {
    this.config = {
      maxFileSize: 50 * 1024 * 1024, // 50MB default
      supportedMimeTypes: [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ],
      defaultTimeout: 30000,
      ...config,
    };
  }

  /**
   * Validate file format and constraints
   */
  async validateFile(file: File): Promise<FileValidation> {
    try {
      // Basic file object validation
      const fileData = {
        name: file.name,
        size: file.size,
        type: file.type,
      };

      const validatedData = FileValidationSchema.parse(fileData);

      // Check file size
      if (file.size > this.config.maxFileSize) {
        throw new ValidationError(
          `File size (${Math.round(file.size / 1024 / 1024)}MB) exceeds maximum allowed size (${Math.round(this.config.maxFileSize / 1024 / 1024)}MB)`
        );
      }

      // Check if file extension is supported
      if (!this.isSupportedFileType(file.name)) {
        const extension = this.getFileExtension(file.name);
        throw new ValidationError(
          `Unsupported file format: ${extension}. Supported formats: ${SUPPORTED_FILE_EXTENSIONS.join(', ')}`
        );
      }

      // Additional MIME type validation if available
      if (file.type && !this.isSupportedMimeType(file.type)) {
        console.warn(`MIME type ${file.type} not in supported list, but file extension is valid`);
      }

      return validatedData;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `File validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if file extension is supported
   */
  isSupportedFileType(filename: string): boolean {
    const extension = this.getFileExtension(filename);
    return extension ? SUPPORTED_FILE_EXTENSIONS.includes(extension as any) : false;
  }

  /**
   * Get file extension from filename
   */
  getFileExtension(filename: string): string | null {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()?.toLowerCase() || null : null;
  }

  /**
   * Check if MIME type is supported
   */
  private isSupportedMimeType(mimeType: string): boolean {
    return this.config.supportedMimeTypes.includes(mimeType);
  }

  /**
   * Get human-readable file size
   */
  getHumanFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

// Export singleton instance
export const fileValidator = new FileValidator(); 