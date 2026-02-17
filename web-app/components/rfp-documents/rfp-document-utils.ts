export function formatDate(dateString?: string): string {
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

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const DOCUMENT_TYPE_STYLES: Record<string, { cls: string }> = {
  PROPOSAL: { cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  EXECUTIVE_BRIEF: { cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  TECHNICAL_PROPOSAL: { cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  COST_PROPOSAL: { cls: 'bg-green-50 text-green-700 border-green-200' },
  PAST_PERFORMANCE: { cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  MANAGEMENT_APPROACH: { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  COMPLIANCE_MATRIX: { cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  TEAMING_AGREEMENT: { cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  NDA: { cls: 'bg-red-50 text-red-700 border-red-200' },
  CONTRACT: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  AMENDMENT: { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  CORRESPONDENCE: { cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  OTHER: { cls: 'bg-gray-50 text-gray-700 border-gray-200' },
} as const;

export function getDocumentTypeStyle(type: string): { cls: string } {
  return DOCUMENT_TYPE_STYLES[type] ?? DOCUMENT_TYPE_STYLES.OTHER;
}
