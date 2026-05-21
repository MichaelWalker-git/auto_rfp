'use client';

import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type { QuestionFileStatus } from '@auto-rfp/core';

interface QuestionFileStatusBadgeProps {
  status: QuestionFileStatus | string;
  needsApproval?: boolean;
  className?: string;
}

const TONE: Record<string, string> = {
  UPLOADED: 'bg-slate-100 text-slate-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  TEXTRACT_RUNNING: 'bg-blue-100 text-blue-700',
  TEXT_READY: 'bg-blue-100 text-blue-700',
  PROCESSED: 'bg-emerald-100 text-emerald-800',
  GENERATING_ANSWERS: 'bg-violet-100 text-violet-700',
  ANSWERS_READY: 'bg-emerald-100 text-emerald-800',
  FILLING_FORMS: 'bg-amber-100 text-amber-800',
  FORMS_READY: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-700',
  DELETED: 'bg-slate-100 text-slate-500',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const LABEL: Record<string, string> = {
  UPLOADED: 'Queued',
  PROCESSING: 'Extracting text…',
  TEXTRACT_RUNNING: 'Extracting text…',
  TEXT_READY: 'Parsing questions…',
  PROCESSED: 'Questions ready',
  GENERATING_ANSWERS: 'Generating answers…',
  ANSWERS_READY: 'Answers ready',
  FILLING_FORMS: 'Filling forms…',
  FORMS_READY: 'Forms ready',
  FAILED: 'Failed',
  DELETED: 'Deleted',
  CANCELLED: 'Cancelled',
};

const isInProgress = (status: string) =>
  status === 'PROCESSING' ||
  status === 'TEXTRACT_RUNNING' ||
  status === 'TEXT_READY' ||
  status === 'UPLOADED' ||
  status === 'GENERATING_ANSWERS' ||
  status === 'FILLING_FORMS';

/**
 * Status chip rendered next to a questionnaire file. Maps the raw QuestionFile
 * status to user-facing "Generating…" / "Ready" / "Failed" labels and adds an
 * extra "Needs approval" pill when the file is processed but contains questions
 * the user hasn't approved yet.
 */
export const QuestionFileStatusBadge = ({
  status, needsApproval, className,
}: QuestionFileStatusBadgeProps) => {
  const tone = TONE[status] ?? 'bg-slate-100 text-slate-700';
  const label = LABEL[status] ?? status;
  const Icon = status === 'FAILED'
    ? AlertCircle
    : status === 'PROCESSED'
      ? CheckCircle2
      : isInProgress(status)
        ? Loader2
        : Clock;
  const animate = isInProgress(status);

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
        <Icon className={cn('h-3 w-3', animate && 'animate-spin')} />
        {label}
      </span>
      {needsApproval && status === 'PROCESSED' && (
        <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50">
          Needs approval
        </Badge>
      )}
    </div>
  );
};
