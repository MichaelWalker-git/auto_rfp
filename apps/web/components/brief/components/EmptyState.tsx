'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export const EmptyState = ({ icon: Icon, title, description, className = "" }: EmptyStateProps) => {
  return (
    <div className={`border rounded-lg p-6 text-center ${className}`}>
      <Icon className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
};