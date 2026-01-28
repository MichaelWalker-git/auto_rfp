'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DebriefingStatusBadge } from './DebriefingStatusBadge';
import { RequestDebriefingDialog } from './RequestDebriefingDialog';
import { useDebriefings } from '@/lib/hooks/use-debriefing';
import { PermissionWrapper } from '@/components/permission-wrapper';
import { Calendar, Clock, Mail, Phone, User, AlertTriangle } from 'lucide-react';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import type { DebriefingItem } from '@auto-rfp/shared';

interface DebriefingCardProps {
  projectId: string;
  orgId: string;
  projectOutcomeStatus?: string;
  onDebriefingChange?: (debriefing: DebriefingItem) => void;
}

export function DebriefingCard({
  projectId,
  orgId,
  projectOutcomeStatus,
  onDebriefingChange,
}: DebriefingCardProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { debriefings, isLoading, refetch } = useDebriefings(orgId, projectId);

  const handleDebriefingSuccess = (newDebriefing: DebriefingItem) => {
    refetch();
    onDebriefingChange?.(newDebriefing);
  };

  // Only show for LOST projects
  if (projectOutcomeStatus !== 'LOST') {
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Debriefing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const latestDebriefing = debriefings[0];
  const isDeadlinePast = latestDebriefing?.requestDeadline
    ? isPast(new Date(latestDebriefing.requestDeadline))
    : false;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Debriefing</CardTitle>
          {!latestDebriefing && (
            <PermissionWrapper requiredPermission="project:edit">
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsDialogOpen(true)}
                className="h-8 text-xs"
              >
                Request Debriefing
              </Button>
            </PermissionWrapper>
          )}
        </CardHeader>

        <CardContent>
          {latestDebriefing ? (
            <div className="space-y-4">
              {/* Status and deadline */}
              <div className="flex items-center justify-between">
                <DebriefingStatusBadge status={latestDebriefing.status} />
                {latestDebriefing.requestDeadline && latestDebriefing.status === 'REQUESTED' && (
                  <div className={`flex items-center gap-1.5 text-xs ${isDeadlinePast ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {isDeadlinePast && <AlertTriangle className="h-3 w-3" />}
                    <Clock className="h-3 w-3" />
                    <span>
                      Deadline: {format(new Date(latestDebriefing.requestDeadline), 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
              </div>

              {/* Contact info */}
              {(latestDebriefing.contactEmail || latestDebriefing.contactName) && (
                <div className="grid gap-2 pt-2 border-t text-sm">
                  {latestDebriefing.contactName && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span>{latestDebriefing.contactName}</span>
                    </div>
                  )}
                  {latestDebriefing.contactEmail && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <a
                        href={`mailto:${latestDebriefing.contactEmail}`}
                        className="hover:underline"
                      >
                        {latestDebriefing.contactEmail}
                      </a>
                    </div>
                  )}
                  {latestDebriefing.contactPhone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      <span>{latestDebriefing.contactPhone}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Scheduled date */}
              {latestDebriefing.scheduledDate && (
                <div className="flex items-center gap-2 text-sm pt-2 border-t">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>
                    Scheduled: {format(new Date(latestDebriefing.scheduledDate), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
              )}

              {/* Findings summary (if completed) */}
              {latestDebriefing.status === 'COMPLETED' && latestDebriefing.findings && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-medium mb-1">Key Findings:</p>
                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {latestDebriefing.findings}
                  </p>
                </div>
              )}

              {/* Request date */}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Requested {formatDistanceToNow(new Date(latestDebriefing.requestDate), { addSuffix: true })}
              </p>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                No debriefing requested yet
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Request a debriefing to learn why your proposal was not selected.
              </p>
              <PermissionWrapper requiredPermission="project:edit">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDialogOpen(true)}
                >
                  Request Debriefing
                </Button>
              </PermissionWrapper>
            </div>
          )}
        </CardContent>
      </Card>

      <RequestDebriefingDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        projectId={projectId}
        orgId={orgId}
        onSuccess={handleDebriefingSuccess}
      />
    </>
  );
}
