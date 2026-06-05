'use client';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck } from 'lucide-react';

export const ApprovalNeededBadge = () => (
  <Badge
    variant="outline"
    className="gap-1 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
  >
    <ClipboardCheck className="h-3 w-3" />
    Approval needed
  </Badge>
);
