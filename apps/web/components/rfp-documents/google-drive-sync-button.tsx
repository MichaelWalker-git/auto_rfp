'use client';

import React, { useCallback, useState } from 'react';
import { ExternalLink, Loader2, Upload, Download, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import type { RFPDocumentItem } from '@/lib/hooks/use-rfp-documents';
import {
  useSyncRFPDocumentToGoogleDrive,
  useSyncRFPDocumentFromGoogleDrive,
} from '@/lib/hooks/use-rfp-documents';

interface GoogleDriveSyncButtonProps {
  document: RFPDocumentItem;
  orgId: string;
  onSyncComplete?: () => void;
}

const GoogleDriveIcon = ({ className }: { className?: string }) => (
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

export const GoogleDriveSyncButton = ({
  document: doc,
  orgId,
  onSyncComplete,
}: GoogleDriveSyncButtonProps) => {
  const { trigger: syncTo } = useSyncRFPDocumentToGoogleDrive(orgId);
  const { trigger: syncFrom } = useSyncRFPDocumentFromGoogleDrive(orgId);
  const { toast } = useToast();
  const [isSyncingTo, setIsSyncingTo] = useState(false);
  const [isSyncingFrom, setIsSyncingFrom] = useState(false);

  const hasContent = !!(doc.fileKey || doc.htmlContentKey);
  const isSynced = !!doc.googleDriveUrl;
  const isBusy = isSyncingTo || isSyncingFrom;

  const handleSyncTo = useCallback(async () => {
    if (isBusy || !hasContent) return;
    try {
      setIsSyncingTo(true);
      await syncTo({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      toast({
        title: isSynced ? 'Re-synced to Google Drive' : 'Synced to Google Drive',
        description: `"${doc.name}" has been uploaded to Google Drive.`,
      });
      onSyncComplete?.();
    } catch (err) {
      toast({
        title: 'Sync to Drive failed',
        description: err instanceof Error ? err.message : 'Could not sync to Google Drive',
        variant: 'destructive',
      });
    } finally {
      setIsSyncingTo(false);
    }
  }, [isBusy, hasContent, isSynced, syncTo, doc, toast, onSyncComplete]);

  const handleSyncFrom = useCallback(async () => {
    if (isBusy || !isSynced) return;
    try {
      setIsSyncingFrom(true);
      const result = await syncFrom({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      toast({
        title: 'Synced from Google Drive',
        description: result.isDocx
          ? `"${doc.name}" has been imported from Google Drive and converted to HTML.`
          : `"${doc.name}" has been imported from Google Drive.`,
      });
      onSyncComplete?.();
    } catch (err) {
      toast({
        title: 'Sync from Drive failed',
        description: err instanceof Error ? err.message : 'Could not sync from Google Drive',
        variant: 'destructive',
      });
    } finally {
      setIsSyncingFrom(false);
    }
  }, [isBusy, isSynced, syncFrom, doc, toast, onSyncComplete]);

  // Don't render if there's nothing to sync and it's never been synced
  if (!hasContent && !isSynced) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 gap-1 text-muted-foreground hover:text-foreground"
          disabled={isBusy}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleDriveIcon className="h-4 w-4" />
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {/* Open in Google Drive — only when synced */}
        {isSynced && (
          <>
            <DropdownMenuItem asChild>
              <a
                href={doc.googleDriveUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 cursor-pointer"
              >
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                <span>Open in Google Drive</span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Sync To Google Drive */}
        {hasContent && (
          <DropdownMenuItem
            onClick={handleSyncTo}
            disabled={isBusy}
            className="flex items-center gap-2 cursor-pointer"
          >
            {isSyncingTo ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-4 w-4 text-muted-foreground" />
            )}
            <span>{isSynced ? 'Re-sync to Google Drive' : 'Sync to Google Drive'}</span>
          </DropdownMenuItem>
        )}

        {/* Sync From Google Drive — only when synced */}
        {isSynced && (
          <DropdownMenuItem
            onClick={handleSyncFrom}
            disabled={isBusy}
            className="flex items-center gap-2 cursor-pointer"
          >
            {isSyncingFrom ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Download className="h-4 w-4 text-muted-foreground" />
            )}
            <span>Sync from Google Drive</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
