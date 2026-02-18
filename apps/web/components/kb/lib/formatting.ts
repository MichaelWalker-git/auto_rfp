import { IndexStatus } from '@auto-rfp/core';

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export function getStatusVariant(status: IndexStatus): 'default' | 'destructive' | 'secondary' {
  if (status === 'INDEXED' || status === 'CHUNKED' || status === 'ready') return 'default';
  if (status === 'failed' || status === 'TEXT_EXTRACTION_FAILED') return 'destructive';
  return 'secondary';
}

export function getStatusLabel(status: IndexStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'TEXT_EXTRACTED':
      return 'Text Extracted';
    case 'TEXT_EXTRACTION_FAILED':
      return 'Extraction Failed';
    case 'CHUNKED':
      return 'Chunked';
    case 'INDEXED':
      return 'Indexed';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}
