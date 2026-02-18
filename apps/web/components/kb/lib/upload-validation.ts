import { UPLOAD_CONFIG } from './upload-config';

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File exceeds maximum size of ${UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
  const isValidType =
    UPLOAD_CONFIG.ALLOWED_TYPES.find(s => s === file.type) ||
    UPLOAD_CONFIG.ALLOWED_EXTENSIONS.find(s => s === extension);

  if (!isValidType) {
    return {
      valid: false,
      error: `File type not supported. Allowed: ${UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  return { valid: true };
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
