/**
 * Shared utility functions for opportunity-related components.
 */

export function formatDateTime(dateString?: string | null): string {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function pickDisplayName(qf: any): string {
  // Priority: explicit fileName > originalFileName > last segment of fileKey (decoded) > fallback
  const fromFileKey = typeof qf?.fileKey === 'string'
    ? decodeURIComponent(qf.fileKey.split('/').pop() ?? '')
    : undefined;

  const raw =
    qf?.fileName ??
    qf?.originalFileName ??
    fromFileKey ??
    'Unknown file';

  // If the name has no extension but the fileKey does, append the extension
  if (raw && !raw.includes('.') && fromFileKey && fromFileKey.includes('.')) {
    const ext = fromFileKey.split('.').pop();
    if (ext) return `${raw}.${ext}`;
  }

  return raw || 'Unknown file';
}

/**
 * Guess a download filename from an S3 key + optional display name.
 * Ensures the result always has a file extension.
 */
export function guessDownloadName(fileKey: string, displayName?: string): string {
  const keyBasename = decodeURIComponent(fileKey.split('/').pop() ?? '');
  const keyExt = keyBasename.includes('.') ? `.${keyBasename.split('.').pop()}` : '';

  if (displayName && displayName !== 'Unknown file' && displayName !== 'download') {
    // If displayName already has an extension, use it as-is
    if (displayName.includes('.')) return displayName;
    // Otherwise append the extension from the key
    return keyExt ? `${displayName}${keyExt}` : displayName;
  }

  // Fall back to the key basename
  return keyBasename || 'download';
}

export function getStatusChip(status?: string): { label: string; cls: string } {
  const s = String(status ?? '').toUpperCase();

  if (s === 'UPLOADED') return { label: 'Uploaded', cls: 'bg-slate-50 text-slate-700 border-slate-200' };
  if (s === 'QUESTIONS_EXTRACTED' || s === 'PROCESSED')
    return { label: 'Completed', cls: 'bg-green-50 text-green-700 border-green-200' };
  if (s === 'TEXT_READY' || s === 'TEXT_EXTRACTED')
    return { label: 'Text ready', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  if (s === 'PROCESSING') return { label: 'Processing', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (s === 'TEXT_EXTRACTION_FAILED' || s === 'ERROR' || s === 'FAILED')
    return { label: 'Error', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (s === 'DELETED') return { label: 'Deleted', cls: 'bg-gray-50 text-gray-700 border-gray-200' };
  if (s === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-gray-50 text-gray-700 border-gray-200' };
  return { label: 'Processing', cls: 'bg-slate-50 text-slate-700 border-slate-200' };
}