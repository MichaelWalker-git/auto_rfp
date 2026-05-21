'use client';

import { AlertTriangle } from 'lucide-react';

interface ReviewRequiredBannerProps {
  className?: string;
}

/**
 * Banner shown above any matrix-style required form. The user must
 * confirm every response column before submitting the proposal.
 */
export const ReviewRequiredBanner = ({ className }: ReviewRequiredBannerProps) => {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${className ?? ''}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">Review Required</div>
        <div className="text-amber-800/90">
          Every compliance response must be confirmed manually before this form is submitted with the proposal.
        </div>
      </div>
    </div>
  );
};
