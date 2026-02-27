'use client';

import React from 'react';
import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface OpportunityActionCardProps {
  /** Icon component to display (from lucide-react) */
  icon: LucideIcon;
  /** Color class for the icon (e.g., 'text-blue-500') */
  iconColor?: string;
  /** Card title */
  title: string;
  /** Card description */
  description: string;
  /** Button text */
  buttonText: string;
  /** Link destination */
  href: string;
}

/**
 * Reusable action card for opportunity pages.
 * Used for Questions, Q&A Engagement, and similar feature entry points.
 */
export const OpportunityActionCard = ({
  icon: Icon,
  iconColor = 'text-blue-500',
  title,
  description,
  buttonText,
  href,
}: OpportunityActionCardProps) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${iconColor}`} />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <Button asChild>
            <Link href={href}>
              <Icon className="h-4 w-4 mr-2" />
              {buttonText}
            </Link>
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
};
