'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  trend?: number; // positive = up, negative = down
  trendLabel?: string;
  className?: string;
  isLoading?: boolean;
  valueClassName?: string;
}

export const KpiCard = ({
  title,
  value,
  description,
  icon: Icon,
  trend,
  trendLabel,
  className,
  isLoading,
  valueClassName,
}: KpiCardProps) => {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4 rounded" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-20 mb-1" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  const hasTrend = trend !== undefined && trend !== null;
  const isPositive = hasTrend && trend > 0;
  const isNegative = hasTrend && trend < 0;

  return (
    <Card className={cn('hover:border-primary/40 transition-colors', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold', valueClassName)}>{value}</div>
        <div className="flex items-center gap-1 mt-1">
          {hasTrend && (
            <span
              className={cn(
                'flex items-center text-xs font-medium',
                isPositive && 'text-emerald-600',
                isNegative && 'text-destructive',
                !isPositive && !isNegative && 'text-muted-foreground',
              )}
            >
              {isPositive && <TrendingUp className="h-3 w-3 mr-0.5" />}
              {isNegative && <TrendingDown className="h-3 w-3 mr-0.5" />}
              {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
            </span>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {trendLabel && (
            <p className="text-xs text-muted-foreground">{trendLabel}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
