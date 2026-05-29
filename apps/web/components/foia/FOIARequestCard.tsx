'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FOIAStatusBadge } from './FOIAStatusBadge';
import { CreateFOIARequestDialog } from './CreateFOIARequestDialog';
import { FOIALetterPreview } from './FOIALetterPreview';
import { useFOIARequests } from '@/lib/hooks/use-foia-requests';
import PermissionWrapper from '@/components/permission-wrapper';
import type { FOIADocumentType, FOIARequestItem } from '@auto-rfp/core';
import { FOIA_DOCUMENT_DESCRIPTIONS } from '@auto-rfp/core';
import { AlertTriangle, Building, ChevronDown, ChevronUp, Clock, FileText, Mail, } from 'lucide-react';
import { format, formatDistanceToNow, isPast } from 'date-fns';

interface FOIARequestCardProps {
  projectId: string;
  orgId: string;
  projectOutcomeStatus?: string;
  agencyName?: string;
  solicitationNumber?: string;
  onFOIAChange?: (foiaRequest: FOIARequestItem) => void;
}

export function FOIARequestCard({
                                  projectId,
                                  orgId,
                                  projectOutcomeStatus,
                                  agencyName,
                                  solicitationNumber,
                                  onFOIAChange,
                                }: FOIARequestCardProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLetterPreviewOpen, setIsLetterPreviewOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<FOIARequestItem | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { foiaRequests, isLoading, refetch } = useFOIARequests(orgId, projectId);

  const handleFOIASuccess = (newFoiaRequest: FOIARequestItem) => {
    refetch();
    onFOIAChange?.(newFoiaRequest);
  };

  const handleViewLetter = (request: FOIARequestItem) => {
    setSelectedRequest(request);
    setIsLetterPreviewOpen(true);
  };

  // Only show for LOST projects
  if (projectOutcomeStatus !== 'LOST') {
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">FOIA Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-6 w-24"/>
            <Skeleton className="h-4 w-48"/>
          </div>
        </CardContent>
      </Card>
    );
  }

  const latestRequest = foiaRequests[0];
  const hasMultiple = foiaRequests.length > 1;
  const isDeadlinePast = latestRequest?.responseDeadline
    ? isPast(new Date(latestRequest.responseDeadline))
    : false;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">FOIA Requests</CardTitle>
          <PermissionWrapper requiredPermission="project:edit">
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="h-8 text-xs"
            >
              New FOIA Request
            </Button>
          </PermissionWrapper>
        </CardHeader>

        <CardContent>
          {latestRequest ? (
            <div className="space-y-4">
              {/* Status and deadline */}
              <div className="flex items-center justify-between">
                <FOIAStatusBadge status={latestRequest.status}/>
                {latestRequest.responseDeadline && latestRequest.status === 'SUBMITTED' && (
                  <div
                    className={`flex items-center gap-1.5 text-xs ${isDeadlinePast ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {isDeadlinePast && <AlertTriangle className="h-3 w-3"/>}
                    <Clock className="h-3 w-3"/>
                    <span>
                      Due: {format(new Date(latestRequest.responseDeadline), 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
              </div>

              {/* Agency info */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building className="h-4 w-4"/>
                <span>{latestRequest.agencyName}</span>
              </div>

              {/* Tracking number if available */}
              {latestRequest.trackingNumber && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground"/>
                  <span>Tracking: {latestRequest.trackingNumber}</span>
                </div>
              )}

              {/* Requested documents */}
              <div className="pt-2 border-t">
                <p className="text-xs font-medium mb-2">Requested Documents:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {latestRequest.requestedDocuments.slice(0, 3).map((doc: FOIADocumentType) => (
                    <li key={doc}>• {FOIA_DOCUMENT_DESCRIPTIONS[doc]}</li>
                  ))}
                  {latestRequest.requestedDocuments.length > 3 && (
                    <li className="text-primary">
                      +{latestRequest.requestedDocuments.length - 3} more
                    </li>
                  )}
                </ul>
              </div>

              {/* Response notes if available */}
              {latestRequest.responseNotes && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-medium mb-1">Response Notes:</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {latestRequest.responseNotes}
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleViewLetter(latestRequest)}
                  className="text-xs"
                >
                  View Letter
                </Button>
                {latestRequest.agencyFOIAEmail && (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="text-xs"
                  >
                    <a href={`mailto:${latestRequest.agencyFOIAEmail}`}>
                      <Mail className="h-3 w-3 mr-1"/>
                      Email Agency
                    </a>
                  </Button>
                )}
              </div>

              {/* Created date */}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Created {formatDistanceToNow(new Date(latestRequest.createdAt), { addSuffix: true })}
              </p>

              {/* Multiple requests toggle */}
              {hasMultiple && (
                <div className="pt-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full text-xs"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3 mr-1"/>
                        Hide {foiaRequests.length - 1} more request(s)
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3 mr-1"/>
                        Show {foiaRequests.length - 1} more request(s)
                      </>
                    )}
                  </Button>

                  {isExpanded && (
                    <div className="mt-3 space-y-3">
                      {foiaRequests.slice(1).map((request) => (
                        <div
                          key={request.id}
                          className="p-3 bg-muted/50 rounded-md space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <FOIAStatusBadge status={request.status}/>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(request.createdAt), 'MMM d, yyyy')}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {request.requestedDocuments.length} document(s) requested
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewLetter(request)}
                            className="text-xs"
                          >
                            View Letter
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                No FOIA requests yet
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Submit a Freedom of Information Act request to obtain evaluation documents.
              </p>
              <PermissionWrapper requiredPermission="project:edit">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDialogOpen(true)}
                >
                  Create FOIA Request
                </Button>
              </PermissionWrapper>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateFOIARequestDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        projectId={projectId}
        orgId={orgId}
        agencyName={agencyName}
        solicitationNumber={solicitationNumber}
        onSuccess={handleFOIASuccess}
      />

      {selectedRequest && (
        <FOIALetterPreview
          isOpen={isLetterPreviewOpen}
          onOpenChange={setIsLetterPreviewOpen}
          foiaRequest={selectedRequest}
          orgId={orgId}
          projectId={projectId}
        />
      )}
    </>
  );
}
