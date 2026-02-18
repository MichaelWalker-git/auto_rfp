'use client';

import React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CalendarClock,
  FolderOpen,
  Tag,
  Target,
} from 'lucide-react';
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
        ) : (
          <div className="text-sm leading-6 whitespace-pre-wrap">
            {opportunity?.description ?? (
              <span className="text-muted-foreground">No description available.</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}