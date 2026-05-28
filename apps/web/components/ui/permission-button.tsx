'use client';

import * as React from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermission } from '@/components/permission-wrapper';
import type { Permission } from '@auto-rfp/core';
import type { VariantProps } from 'class-variance-authority';
import { Lock } from 'lucide-react';
import { RoleInfoPopover } from '@/components/organizations/RoleInfoPopover';

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export interface PermissionButtonProps extends ButtonProps {
  /** The permission required to enable the button */
  requiredPermission: Permission;
  /** Tooltip message when button is enabled (has permission) */
  tooltip?: string;
  /** Custom tooltip message when permission is denied. Defaults to standard message. */
  deniedTooltip?: string;
  /** If true, hides the button entirely when permission is denied (legacy behavior) */
  hideWhenDenied?: boolean;
}

/**
 * A Button that is automatically disabled with a tooltip when the user lacks the required permission.
 * 
 * This provides better UX than hiding the button entirely — users can see the action exists
 * but understand they need elevated permissions to use it.
 * 
 * @example
 * ```tsx
 * <PermissionButton
 *   requiredPermission="document:delete"
 *   variant="destructive"
 *   onClick={handleDelete}
 * >
 *   Delete Document
 * </PermissionButton>
 * ```
 */
export const PermissionButton = React.forwardRef<HTMLButtonElement, PermissionButtonProps>(
  (
    {
      requiredPermission,
      tooltip,
      deniedTooltip,
      hideWhenDenied = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const hasPermission = usePermission(requiredPermission);

    // If user lacks permission and hideWhenDenied is true, render nothing
    if (!hasPermission && hideWhenDenied) {
      return null;
    }

    const deniedMessage =
      deniedTooltip ??
      `You don't have permission to perform this action. Contact your admin for access.`;

    // If user has permission, render button with optional tooltip
    if (hasPermission) {
      if (tooltip) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button ref={ref} disabled={disabled} {...props}>
                {children}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        );
      }
      return (
        <Button ref={ref} disabled={disabled} {...props}>
          {children}
        </Button>
      );
    }

    // User lacks permission — show disabled button with tooltip
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrap in span to make tooltip work on disabled button */}
          <span className="inline-flex">
            <Button
              ref={ref}
              disabled={true}
              {...props}
              className={`${props.className ?? ''} cursor-not-allowed`}
            >
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs"
        >
          <div className="flex items-center gap-2">
            <Lock className="h-3 w-3 shrink-0" />
            <span>{deniedMessage}</span>
            <RoleInfoPopover variant="light" />
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
);

PermissionButton.displayName = 'PermissionButton';
