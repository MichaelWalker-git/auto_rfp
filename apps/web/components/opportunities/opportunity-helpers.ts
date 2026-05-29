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
  return (
    qf?.fileName ??
    qf?.originalFileName ??
    (typeof qf?.fileKey === 'string' ? qf.fileKey.split('/').pop() : undefined) ??
    'Unknown file'
  );
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