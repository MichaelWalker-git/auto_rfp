'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface BaseCardProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  isHoverable?: boolean;
}

export function BaseCard({
  title,
  subtitle,
  children,
  actions,
  footer,
  className,
  onClick,
  isHoverable = false,
}: BaseCardProps) {
  const baseClasses = 'group overflow-hidden transition-all duration-200 flex flex-col h-full border';
  const hoverClasses = isHoverable ? 'hover:shadow-lg hover:border-primary/50 cursor-pointer' : '';
  const interactiveClasses = onClick ? '' : '';

  return (
    <Card className={`${baseClasses} ${hoverClasses} ${interactiveClasses} ${className || ''}`} onClick={onClick}>
      <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold line-clamp-2 break-words">{title}</CardTitle>
            {subtitle && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground break-all">{subtitle}</p>}
          </div>
          {actions && (
            <div className="flex gap-1 flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {actions}
            </div>
          )}
        </div>
      </CardHeader>

      {children && (
        <CardContent className="px-4 py-3 flex-1 min-h-0 overflow-hidden">
          <div className="space-y-2 text-sm">
            {children}
          </div>
        </CardContent>
      )}

      {footer && (
        <div className="px-4 py-2 border-t border-border/50 bg-muted/30 flex-shrink-0">
          {footer}
        </div>
      )}
    </Card>
  );
}
