'use client';

import Link from 'next/link';
import { LucideIcon, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface StatItem {
  label: string;
  value: string | number;
  variant?: 'default' | 'success' | 'warning' | 'destructive';
}

interface OpportunityActionCardProps {
  /** Icon component to display (from lucide-react) */
  icon: LucideIcon;
  /** Color class for the icon (e.g., 'text-blue-500') */
  iconColor?: string;
  /** Background gradient for the icon container */
  iconBgGradient?: string;
  /** Card title */
  title: string;
  /** Card description */
  description: string;
  /** Button text */
  buttonText: string;
  /** Link destination */
  href: string;
  /** Optional stats to display */
  stats?: StatItem[];
  /** Optional progress indicator (0-100) */
  progress?: {
    value: number;
    label: string;
  };
  /** Optional badge text */
  badge?: {
    text: string;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  };
  /** Card variant for different visual styles */
  variant?: 'default' | 'compact';
}

/**
 * Enhanced action card for opportunity pages.
 * Used for Questions, Q&A Engagement, and similar feature entry points.
 * Now supports stats, progress indicators, and badges for better context.
 */
export const OpportunityActionCard = ({
  icon: Icon,
  iconColor = 'text-blue-500',
  iconBgGradient = 'from-blue-50 to-blue-100',
  title,
  description,
  buttonText,
  href,
  stats,
  progress,
  badge,
  variant = 'default',
}: OpportunityActionCardProps) => {
  if (variant === 'compact') {
    return (
      <Link href={href} className="block">
        <Card className="group hover:shadow-md transition-shadow h-full">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
                'bg-gradient-to-br',
                iconBgGradient
              )}>
                <Icon className={cn('h-5 w-5', iconColor)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold">{title}</CardTitle>
                  {badge && (
                    <Badge variant={badge.variant ?? 'default'} className="text-xs">
                      {badge.text}
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs line-clamp-1">{description}</CardDescription>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </CardHeader>
        </Card>
      </Link>
    );
  }

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center shrink-0',
              'bg-gradient-to-br shadow-sm',
              iconBgGradient
            )}>
              <Icon className={cn('h-6 w-6', iconColor)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <CardTitle className="text-lg font-semibold">{title}</CardTitle>
                {badge && (
                  <Badge variant={badge.variant ?? 'default'} className="text-xs">
                    {badge.text}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-sm">{description}</CardDescription>
            </div>
          </div>
          <Button asChild size="default" className="shrink-0">
            <Link href={href}>
              <Icon className="h-4 w-4 mr-2" />
              {buttonText}
            </Link>
          </Button>
        </div>
      </CardHeader>

      {(stats || progress) && (
        <CardContent className="pt-0">
          {stats && stats.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
              {stats.map((stat, idx) => (
                <div key={idx} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className={cn(
                    'text-lg font-semibold',
                    stat.variant === 'success' && 'text-green-600',
                    stat.variant === 'warning' && 'text-orange-600',
                    stat.variant === 'destructive' && 'text-red-600'
                  )}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{progress.label}</span>
                <span className="font-medium">{progress.value}%</span>
              </div>
              <Progress value={progress.value} className="h-2" />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};
