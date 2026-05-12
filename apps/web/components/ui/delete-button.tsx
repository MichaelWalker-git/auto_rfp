'use client';

import React from 'react';
import { Trash2, Loader2, Lock } from 'lucide-react';
import { RoleInfoPopover } from '@/components/organizations/RoleInfoPopover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermission } from '@/components/permission-wrapper';
import type { Permission } from '@auto-rfp/core';

export interface DeleteButtonProps {
  /** Whether the delete is in progress */
  isLoading?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Callback when delete is clicked */
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
 * Reusable delete button component
 * Handles loading state and provides consistent UX across the app
 */
export function DeleteButton({
  isLoading = false,
  disabled = false,
  onClick,
  size = 'sm',
  variant = 'destructive',
  ariaLabel = 'Delete',
  className,
  showLabel = false,
  label = 'Delete',
}: DeleteButtonProps) {
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
        <Trash2 className="h-4 w-4" />
      )}
      {showLabel && <span className="ml-2">{label}</span>}
    </Button>
  );
}

export interface PermissionDeleteButtonProps extends Omit<DeleteButtonProps, 'disabled'> {
  /** The permission required to enable the button */
  requiredPermission: Permission;
  /** Custom tooltip message when permission is denied */
  deniedTooltip?: string;
}

/**
 * Delete button that shows disabled state with tooltip when user lacks permission.
 * Use this instead of wrapping DeleteButton with PermissionWrapper to provide better UX.
 */
export const PermissionDeleteButton = ({
  requiredPermission,
  deniedTooltip,
  isLoading = false,
  onClick,
  size = 'sm',
  variant = 'destructive',
  ariaLabel = 'Delete',
  className,
  showLabel = false,
  label = 'Delete',
}: PermissionDeleteButtonProps) => {
  const hasPermission = usePermission(requiredPermission);
  const tooltipMessage =
    deniedTooltip ?? `You don't have permission to delete this item. Contact your admin for access.`;

  // If user has permission, render normal delete button
  if (hasPermission) {
    return (
      <DeleteButton
        isLoading={isLoading}
        onClick={onClick}
        size={size}
        variant={variant}
        ariaLabel={ariaLabel}
        className={className}
        showLabel={showLabel}
        label={label}
      />
    );
  }

  // User lacks permission — show disabled button with tooltip
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            size={size}
            variant={variant}
            disabled={true}
            aria-label={ariaLabel}
            className={`${className ?? ''} cursor-not-allowed`}
          >
            <Trash2 className="h-4 w-4" />
            {showLabel && <span className="ml-2">{label}</span>}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex items-center gap-2">
          <Lock className="h-3 w-3 shrink-0" />
          <span>{tooltipMessage}</span>
          <RoleInfoPopover variant="light" />
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
