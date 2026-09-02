'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface TabBarItemProps {
  id: string;
  label: string;
  icon?: string;
  isActive?: boolean;
  onClick?: (tabId: string) => void;
  className?: string;
}

export const TabBarItem = ({
  id,
  label,
  icon,
  isActive = false,
  onClick,
  className
}: TabBarItemProps) => {
  const handleClick = () => {
    if (onClick) {
      onClick(id);
    }
  };

  return (
    <Button
      variant={isActive ? "default" : "outline"}
      size="sm"
      className={cn(
        "h-8 px-3 text-xs font-medium",
        className,
        isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      )}
      onClick={handleClick}
    >
      {icon && <span className="mr-1">{icon}</span>}
      {label}
    </Button>
  );
};