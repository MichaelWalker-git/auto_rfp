'use client';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, Clock, CheckCircle2, XCircle, Ban } from 'lucide-react';
import type { DocumentApprovalStatus } from '@auto-rfp/core';

interface ApprovalStatusBadgeProps {
  status: DocumentApprovalStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  DocumentApprovalStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  PENDING: {
    label: 'Pending Review',
    icon: Clock,
    className: 'border-amber-300 text-amber-700 bg-amber-50',
  },
  APPROVED: {
    label: 'Approved',
    icon: CheckCircle2,
    className: 'border-emerald-300 text-emerald-700 bg-emerald-50',
  },
  REJECTED: {
    label: 'Rejected',
    icon: XCircle,
    className: 'border-red-300 text-red-700 bg-red-50',
  },
  CANCELLED: {
    label: 'Cancelled',
    icon: Ban,
    className: 'border-slate-300 text-slate-600 bg-slate-50',
  },
};

export const ApprovalStatusBadge = ({ status, className }: ApprovalStatusBadgeProps) => {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={`text-xs gap-1 ${config.className} ${className ?? ''}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
};
