export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_BATCH_SIZE: 100,
  MAX_RETRY_ATTEMPTS: 3,
  ALLOWED_TYPES: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  ALLOWED_EXTENSIONS: ['.pdf', '.doc', '.docx', '.txt', '.csv', '.xls', '.xlsx'],
} as const;

export type UploadStatus = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';

export interface UploadQueueItem {
  id: string;
  file: File;
  fileName: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  retryCount: number;
  documentId?: string;
}
