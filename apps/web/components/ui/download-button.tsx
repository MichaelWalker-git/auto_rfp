'use client';

import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface DownloadButtonProps {
  /** Whether the download is in progress */
  isLoading?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Callback when download is clicked */
  onClick: () => void | Promise<void>;
  /** Button size */
  size?: 'sm' | 'icon' | 'default' | 'lg';
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  /** Aria label for accessibility */
  ariaLabel?: string;
  /** Custom className */
  className?: string;
  /** Show text label */
  showLabel?: boolean;
  /** Custom label text */
  label?: string;
}

/**
 * Reusable download button component
 * Handles loading state and provides consistent UX across the app
 */
export function DownloadButton({
  isLoading = false,
  disabled = false,
  onClick,
  size = 'sm',
  variant = 'outline',
  ariaLabel = 'Download',
  className,
  showLabel = false,
  label = 'Download',
}: DownloadButtonProps) {
  return (
    <Button
      size={size}
      variant={variant}
      disabled={disabled || isLoading}
      onClick={onClick}
      aria-label={ariaLabel}
      className={className}
      title={ariaLabel}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {showLabel && <span className="ml-2">{label}</span>}
    </Button>
  );
}