'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { type SignatureStatus, SIGNATURE_STATUSES } from '@/lib/hooks/use-rfp-documents';

interface Props {
  status: SignatureStatus;
}

const STATUS_STYLES: Record<SignatureStatus, string> = {
  NOT_REQUIRED: 'bg-gray-50 text-gray-600 border-gray-200',
  PENDING_SIGNATURE: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  PARTIALLY_SIGNED: 'bg-orange-50 text-orange-700 border-orange-200',
  FULLY_SIGNED: 'bg-green-50 text-green-700 border-green-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

const STATUS_EMOJI: Record<SignatureStatus, string> = {
  NOT_REQUIRED: '',
  PENDING_SIGNATURE: '⏳',
  PARTIALLY_SIGNED: '✍️',
  FULLY_SIGNED: '✅',
  REJECTED: '❌',
};

export function SignatureStatusBadge({ status }: Props) {
  if (status === 'NOT_REQUIRED') return null;

  return (
    <Badge variant="outline" className={`text-xs border ${STATUS_STYLES[status]}`}>
      {STATUS_EMOJI[status]} {SIGNATURE_STATUSES[status]}
    </Badge>
  );
}