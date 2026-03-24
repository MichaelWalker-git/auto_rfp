'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateFOIARequestDialog } from './CreateFOIARequestDialog';
import { useFOIARequests, useGenerateFOIALetter } from '@/lib/hooks/use-foia-requests';
import { useToast } from '@/components/ui/use-toast';
import PermissionWrapper from '@/components/permission-wrapper';
import type { FOIADocumentType, FOIARequestItem } from '@auto-rfp/core';
import { FOIA_DOCUMENT_DESCRIPTIONS } from '@auto-rfp/core';
import {
  Building2,
  Scale,
  Mail,
  Loader2,
  Pencil,
  FileText,
  Briefcase,
  Calendar,
  User,
  Phone,
  MapPin,
  DollarSign,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface FOIARequestCardProps {
  projectId: string;
  orgId: string;
  opportunityId: string;
  projectOutcomeStatus?: string;
  agencyName?: string;
  solicitationNumber?: string;
  contractTitle?: string;
  onFOIAChange?: (foiaRequest: FOIARequestItem) => void;
}

export const FOIARequestCard = ({
  projectId,
  orgId,
  opportunityId,
  projectOutcomeStatus,
  agencyName,
  solicitationNumber,
  contractTitle,
  onFOIAChange,
}: FOIARequestCardProps) => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const { foiaRequests, isLoading, refetch } = useFOIARequests(orgId, projectId, opportunityId);
  const { generateFOIALetter } = useGenerateFOIALetter();
  const { toast } = useToast();

  const handleSuccess = (foiaRequest: FOIARequestItem) => {
    refetch();
    onFOIAChange?.(foiaRequest);
  };

  const handleDraftLetter = async (request: FOIARequestItem) => {
    setIsDrafting(true);
    try {
      const letter = await generateFOIALetter(orgId, projectId, opportunityId, request.id);

      const subject = encodeURIComponent(
        `FOIA Request — Solicitation No. ${request.solicitationNumber ?? ''}, ${request.contractTitle ?? ''}`
      );
      const body = encodeURIComponent(letter);
      const to = request.agencyFOIAEmail ?? '';
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
            <Scale className="h-4 w-4" />
            FOIA Request
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-24"/>
            <Skeleton className="h-4 w-48"/>
            <Skeleton className="h-4 w-32"/>
          </div>
        </CardContent>
      </Card>
    );
  }

  const existingRequest = foiaRequests[0];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Scale className="h-4 w-4" />
            FOIA Request
          </CardTitle>
        </CardHeader>

        <CardContent>
          {existingRequest ? (
            <div className="space-y-4">
              {/* Agency info */}
              <div className="grid gap-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 shrink-0"/>
                  <span>{existingRequest.agencyName}</span>
                </div>
                {existingRequest.agencyFOIAEmail && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 shrink-0"/>
                    <span>{existingRequest.agencyFOIAEmail}</span>
                  </div>
                )}
                {existingRequest.agencyFOIAAddress && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0"/>
                    <span>{existingRequest.agencyFOIAAddress}</span>
                  </div>
                )}
              </div>

              {/* Contract details */}
              <div className="grid gap-1.5 pt-2 border-t text-xs text-muted-foreground">
                {existingRequest.solicitationNumber && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0"/>
                    <span>Solicitation: {existingRequest.solicitationNumber}</span>
                  </div>
                )}
                {existingRequest.contractTitle && (
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 shrink-0"/>
                    <span>Contract: {existingRequest.contractTitle}</span>
                  </div>
                )}
                {existingRequest.awardeeName && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 shrink-0"/>
                    <span>Awardee: {existingRequest.awardeeName}</span>
                  </div>
                )}
                {existingRequest.awardDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 shrink-0"/>
                    <span>Award Date: {existingRequest.awardDate}</span>
                  </div>
                )}
              </div>

              {/* Requested documents */}
              <div className="pt-2 border-t">
                <p className="text-xs font-medium mb-2">Requested Documents:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {existingRequest.requestedDocuments.map((doc: FOIADocumentType) => (
                    <li key={doc}>• {FOIA_DOCUMENT_DESCRIPTIONS[doc]}</li>
                  ))}
                </ul>
                {existingRequest.customDocumentRequests && existingRequest.customDocumentRequests.length > 0 && (
                  <ul className="text-xs text-muted-foreground space-y-1 mt-1">
                    {existingRequest.customDocumentRequests.map((custom: string, idx: number) => (
                      <li key={idx}>• {custom}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Fee limit */}
              {existingRequest.feeLimit > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t text-xs text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5 shrink-0"/>
                  <span>Fee Limit: ${existingRequest.feeLimit.toFixed(2)}</span>
                </div>
              )}

              {/* Requester information */}
              <div className="grid gap-1.5 pt-2 border-t text-xs text-muted-foreground">
                <p className="text-xs font-medium text-foreground">Requester</p>
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 shrink-0"/>
                  <span>{existingRequest.requesterName}{existingRequest.requesterTitle ? `, ${existingRequest.requesterTitle}` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 shrink-0"/>
                  <span>{existingRequest.requesterEmail}</span>
                </div>
                {existingRequest.requesterPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 shrink-0"/>
                    <span>{existingRequest.requesterPhone}</span>
                  </div>
                )}
                {existingRequest.requesterAddress && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0"/>
                    <span>{existingRequest.requesterAddress}</span>
                  </div>
                )}
                {existingRequest.companyName && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 shrink-0"/>
                    <span>{existingRequest.companyName}</span>
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
                  onClick={() => handleDraftLetter(existingRequest)}
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

              {/* Created date */}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Created {formatDistanceToNow(new Date(existingRequest.createdAt), { addSuffix: true })}
              </p>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                No FOIA request yet
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Submit a Freedom of Information Act request to obtain evaluation documents.
              </p>
              <PermissionWrapper requiredPermission="project:edit">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  Create FOIA Request
                </Button>
              </PermissionWrapper>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateFOIARequestDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        projectId={projectId}
        orgId={orgId}
        opportunityId={opportunityId}
        agencyName={agencyName}
        solicitationNumber={solicitationNumber}
        contractTitle={contractTitle}
        onSuccess={handleSuccess}
      />

      {existingRequest && (
        <CreateFOIARequestDialog
          key={existingRequest.foiaId}
          isOpen={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          projectId={projectId}
          orgId={orgId}
          opportunityId={opportunityId}
          agencyName={agencyName}
          solicitationNumber={solicitationNumber}
          contractTitle={contractTitle}
          existingRequest={existingRequest}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
};
