'use client';

import React from 'react';
import Link from 'next/link';
import DOMPurify from 'dompurify';
import {
  AlertCircle,
  CalendarClock,
  FolderOpen,
  Tag,
  Target,
  UserCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOpportunityContext } from './opportunity-context';
import { useCurrentOrganization } from '@/context/organization-context';
import { formatDateTime } from './opportunity-helpers';

export function OpportunityHeader() {
  const { projectId, oppId, opportunity, isLoading, error, refetch } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id;

  const briefUrl = orgId
    ? `/organizations/${orgId}/projects/${projectId}/brief?opportunityId=${oppId}`
    : '#';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 truncate">
            <FolderOpen className="h-5 w-5" />
            {isLoading ? 'Loading opportunity…' : opportunity?.title ?? 'Opportunity'}
          </CardTitle>
          <CardDescription className="truncate">
            {opportunity?.organizationName ?? '—'}
          </CardDescription>

          {opportunity && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary">{opportunity.source}</Badge>
              {opportunity.active ? <Badge>ACTIVE</Badge> : <Badge variant="outline">INACTIVE</Badge>}
              {opportunity.type && <Badge variant="outline">{opportunity.type}</Badge>}
              {opportunity.naicsCode && (
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-3.5 w-3.5" />
                  NAICS {opportunity.naicsCode}
                </Badge>
              )}
              {opportunity.pscCode && <Badge variant="outline">PSC {opportunity.pscCode}</Badge>}
              {opportunity.setAside && <Badge variant="outline">{opportunity.setAside}</Badge>}
              {opportunity.solicitationNumber && (
                <Badge variant="outline">Solicitation {opportunity.solicitationNumber}</Badge>
              )}
              {opportunity.noticeId && <Badge variant="outline">Notice {opportunity.noticeId}</Badge>}
            </div>
          )}

          {opportunity && (
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                Posted: {formatDateTime(opportunity.postedDateIso)}
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                Due: {formatDateTime(opportunity.responseDeadlineIso)}
              </span>
            </div>
          )}

          {/* Audit info — who created / last updated */}
          {opportunity && (opportunity.createdByName ?? opportunity.updatedByName) ? (
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {opportunity.createdByName ? (
                <span className="inline-flex items-center gap-1">
                  <UserCircle2 className="h-3.5 w-3.5" />
                  Created by: <span className="text-foreground/90 ml-1">{opportunity.createdByName}</span>
                </span>
              ) : null}
              {opportunity.updatedByName && opportunity.updatedByName !== opportunity.createdByName ? (
                <span className="inline-flex items-center gap-1">
                  <UserCircle2 className="h-3.5 w-3.5" />
                  Updated by: <span className="text-foreground/90 ml-1">{opportunity.updatedByName}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={briefUrl}>
              <Target className="h-4 w-4 mr-2" />
              Executive Brief
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : opportunity?.description ? (
          <div
            className={cn(
              'prose prose-sm max-w-none text-sm text-muted-foreground leading-relaxed',
              '[&_p]:mb-2 [&_p:last-child]:mb-0',
              '[&_div]:mb-1',
              '[&_ul]:mb-2 [&_ul]:pl-5 [&_ul>li]:list-disc [&_ul>li]:mb-0.5',
              '[&_ol]:mb-2 [&_ol]:pl-5 [&_ol>li]:list-decimal [&_ol>li]:mb-0.5',
              '[&_strong]:font-semibold [&_strong]:text-foreground',
              '[&_b]:font-semibold [&_b]:text-foreground',
              '[&_em]:italic',
              '[&_u]:underline',
              '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-3 [&_h1]:mb-1',
              '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1',
              '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-2 [&_h3]:mb-0.5',
              '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80',
              '[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:mb-2',
              '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-left',
              '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
              '[&_hr]:border-border [&_hr]:my-2',
              '[&_span]:leading-relaxed',
            )}
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(opportunity.description, {
                ALLOWED_TAGS: [
                  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's',
                  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                  'ul', 'ol', 'li',
                  'a', 'blockquote', 'code', 'pre', 'hr',
                  'table', 'thead', 'tbody', 'tr', 'th', 'td',
                ],
                ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
                FORCE_BODY: true,
              }),
            }}
          />
        ) : (
          <span className="text-sm text-muted-foreground">No description available.</span>
        )}
      </CardContent>
    </Card>
  );
}