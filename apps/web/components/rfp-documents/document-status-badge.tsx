'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  GENERATING: { label: 'Generating…', className: 'border-amber-300 text-amber-700 bg-amber-50 animate-pulse' },
  DRAFT: { label: 'Draft', className: 'border-slate-300 text-slate-600 bg-slate-50' },
  IN_PROGRESS: { label: 'In Progress', className: 'border-blue-300 text-blue-700 bg-blue-50' },
  NEEDS_REVIEW: { label: 'Needs Review', className: 'border-orange-300 text-orange-700 bg-orange-50' },
  READY: { label: 'Ready', className: 'border-emerald-300 text-emerald-700 bg-emerald-50' },
  APPROVED: { label: 'Approved', className: 'border-green-300 text-green-700 bg-green-50' },
  FAILED: { label: 'Failed', className: 'border-red-300 text-red-700 bg-red-50' },
};

interface DocumentStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export const DocumentStatusBadge = ({ status, className }: DocumentStatusBadgeProps) => {
  if (!status) return null;
  const config = STATUS_CONFIG[status];
  if (!config) return null;
  return (
    <Badge variant="outline" className={cn('text-xs', config.className, className)}>
      {config.label}
    </Badge>
  );
};
