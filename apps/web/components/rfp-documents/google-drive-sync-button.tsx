'use client';

import React, { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import type { RFPDocumentItem } from '@/lib/hooks/use-rfp-documents';
import { useSyncRFPDocumentToGoogleDrive } from '@/lib/hooks/use-rfp-documents';

interface GoogleDriveSyncButtonProps {
  document: RFPDocumentItem;
  orgId: string;
  onSyncComplete?: () => void;
}

function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 87.3 78"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-20.4 35.3c-.8 1.4-1.2 2.95-1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-10.1-17.5c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 23.8h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}

export function GoogleDriveSyncButton({
  document: doc,
  orgId,
  onSyncComplete,
}: GoogleDriveSyncButtonProps) {
  const { trigger: syncToGoogleDrive } = useSyncRFPDocumentToGoogleDrive(orgId);
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const hasFile = !!doc.fileKey;
  const isAlreadySynced = !!doc.googleDriveUrl;

  const handleSync = useCallback(async () => {
    if (isSyncing || !hasFile) return;

    try {
      setIsSyncing(true);
      await syncToGoogleDrive({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      toast({
        title: 'Synced to Google Drive',
        description: `"${doc.name}" has been uploaded to Google Drive.`,
      });
      onSyncComplete?.();
    } catch (err) {
      toast({
        title: 'Sync failed',
        description: err instanceof Error ? err.message : 'Could not sync to Google Drive',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, hasFile, syncToGoogleDrive, doc, toast, onSyncComplete]);

  if (!hasFile && !isAlreadySynced) return null;

  if (isAlreadySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            asChild
          >
            <a
              href={doc.googleDriveUrl!}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GoogleDriveIcon className="h-4 w-4" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Open in Google Drive</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={isSyncing}
          onClick={handleSync}
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleDriveIcon className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Sync to Google Drive</p>
      </TooltipContent>
    </Tooltip>
  );
}
