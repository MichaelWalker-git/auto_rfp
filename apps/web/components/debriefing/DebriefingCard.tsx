'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RequestDebriefingDialog } from './RequestDebriefingDialog';
import { useDebriefings, useGenerateDebriefingLetter } from '@/lib/hooks/use-debriefing';
import { useToast } from '@/components/ui/use-toast';
import PermissionWrapper from '@/components/permission-wrapper';
import {
  User,
  MessageSquare,
  FileText,
  Building2,
  Mail,
  Loader2,
  Pencil,
  Calendar,
  Briefcase,
  MapPin,
  Phone,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { DebriefingItem } from '@auto-rfp/core';

interface DebriefingCardProps {
  projectId: string;
  orgId: string;
  opportunityId: string;
  projectOutcomeStatus?: string;
  /** Pre-populate dialog from opportunity data */
  solicitationNumber?: string;
  contractTitle?: string;
  onDebriefingChange?: (debriefing: DebriefingItem) => void;
}

export const DebriefingCard = ({
  projectId,
  orgId,
  opportunityId,
  projectOutcomeStatus,
  solicitationNumber,
  contractTitle,
  onDebriefingChange,
}: DebriefingCardProps) => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const { debriefings, isLoading, refetch } = useDebriefings(orgId, projectId, opportunityId);
  const { generateDebriefingLetter } = useGenerateDebriefingLetter();
  const { toast } = useToast();

  const handleSuccess = (debriefing: DebriefingItem) => {
    refetch();
    onDebriefingChange?.(debriefing);
  };

  const handleDraftLetter = async (debriefing: DebriefingItem) => {
    setIsDrafting(true);
    try {
      const letter = await generateDebriefingLetter(orgId, projectId, opportunityId, debriefing.debriefId);

      const subject = encodeURIComponent(
        `POST-AWARD DEBRIEFING REQUEST — Solicitation No. ${debriefing.solicitationNumber ?? ''}, ${debriefing.contractTitle ?? ''}`
      );
      const body = encodeURIComponent(letter);
      const to = debriefing.contractingOfficerEmail ?? '';
      window.open(`mailto:${to}?subject=${subject}&body=${body}`);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate letter',
        variant: 'destructive',
      });
    } finally {
      setIsDrafting(false);
    }
  };

  // Only show for LOST projects
  if (projectOutcomeStatus !== 'LOST') {
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Debriefing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const latestDebriefing = debriefings[0];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Debriefing
          </CardTitle>
        </CardHeader>

        <CardContent>
          {latestDebriefing ? (
            <div className="space-y-4">
              {/* Contracting officer */}
              {latestDebriefing.contractingOfficerName && (
                <div className="grid gap-1.5 text-xs text-muted-foreground">
                  <p className="text-xs font-medium text-foreground">Contracting Officer</p>
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span>{latestDebriefing.contractingOfficerName}</span>
                  </div>
                  {latestDebriefing.contractingOfficerEmail && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span>{latestDebriefing.contractingOfficerEmail}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Contract details */}
              <div className="grid gap-1.5 pt-2 border-t text-xs text-muted-foreground">
                {latestDebriefing.solicitationNumber && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span>Solicitation: {latestDebriefing.solicitationNumber}</span>
                  </div>
                )}
                {latestDebriefing.contractTitle && (
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 shrink-0" />
                    <span>Contract: {latestDebriefing.contractTitle}</span>
                  </div>
                )}
                {latestDebriefing.awardedOrganization && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Awardee: {latestDebriefing.awardedOrganization}</span>
                  </div>
                )}
                {latestDebriefing.awardNotificationDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span>Award Date: {latestDebriefing.awardNotificationDate}</span>
                  </div>
                )}
              </div>

              {/* Requester information */}
              <div className="grid gap-1.5 pt-2 border-t text-xs text-muted-foreground">
                <p className="text-xs font-medium text-foreground">Requester</p>
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span>{latestDebriefing.requesterName}{latestDebriefing.requesterTitle ? `, ${latestDebriefing.requesterTitle}` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span>{latestDebriefing.requesterEmail}</span>
                </div>
                {latestDebriefing.requesterPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span>{latestDebriefing.requesterPhone}</span>
                  </div>
                )}
                {latestDebriefing.requesterAddress && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>{latestDebriefing.requesterAddress}</span>
                  </div>
                )}
                {latestDebriefing.companyName && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{latestDebriefing.companyName}</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t">
                <PermissionWrapper requiredPermission="project:edit">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditDialogOpen(true)}
                    className="text-xs"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                </PermissionWrapper>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDraftLetter(latestDebriefing)}
                  disabled={isDrafting}
                  className="text-xs"
                >
                  {isDrafting ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Mail className="h-3.5 w-3.5 mr-1" />
                  )}
                  Draft Letter
                </Button>
              </div>

              {/* Request creation date */}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Created {formatDistanceToNow(new Date(latestDebriefing.createdAt), { addSuffix: true })}
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
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  Request Debriefing
                </Button>
              </PermissionWrapper>
            </div>
          )}
        </CardContent>
      </Card>

      <RequestDebriefingDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        projectId={projectId}
        orgId={orgId}
        opportunityId={opportunityId}
        solicitationNumber={solicitationNumber}
        contractTitle={contractTitle}
        onSuccess={handleSuccess}
      />

      {latestDebriefing && (
        <RequestDebriefingDialog
          key={latestDebriefing.debriefId}
          isOpen={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          projectId={projectId}
          orgId={orgId}
          opportunityId={opportunityId}
          solicitationNumber={solicitationNumber}
          contractTitle={contractTitle}
          existingDebriefing={latestDebriefing}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
};
