'use client';

import React, { useCallback, useState } from 'react';
import { ExternalLink, Loader2, Upload, Download, ChevronDown, AlertTriangle, FileCheck } from 'lucide-react';
import Link from 'next/link';
import { PermissionButton } from '@/components/ui/permission-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  ApiError,
  useSyncRFPDocumentToGoogleDrive,
  useSyncRFPDocumentFromGoogleDrive,
} from '@/lib/hooks/use-rfp-documents';
import { useCurrentOrganization } from '@/context/organization-context';

interface GoogleDriveSyncButtonProps {
  document: RFPDocumentItem;
  orgId: string;
  onSyncComplete?: () => void;
  /**
   * Suppresses "Pull from Google Drive" only. An import replaces the document's HTML,
   * so pulling under an editor with unsaved changes means the next Save silently
   * clobbers what was just imported. Pushing stays available.
   */
  isPullDisabled?: boolean;
  /** Explains the disabled pull in the menu, e.g. "Save your changes first". */
  pullDisabledReason?: string;
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

/**
 * True when the failure body carries `code: 'DRIVE_NOT_CONFIGURED'`. The handler
 * returns an explicit code so this no longer has to sniff error-message strings —
 * which broke the moment the wording changed.
 */
const isDriveNotConfiguredError = (err: unknown): boolean => {
  if (!(err instanceof ApiError)) return false;
  try {
    const body: unknown = JSON.parse(err.message);
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as { code?: unknown }).code === 'DRIVE_NOT_CONFIGURED'
    );
  } catch {
    return false;
  }
};

/** Pull the human-readable message out of a JSON error body, falling back to the raw text. */
const readErrorMessage = (err: unknown, fallback: string): string => {
  if (!(err instanceof Error)) return fallback;
  try {
    const body: unknown = JSON.parse(err.message);
    if (typeof body === 'object' && body !== null) {
      const { error, message } = body as { error?: unknown; message?: unknown };
      if (typeof error === 'string') return error;
      if (typeof message === 'string') return message;
    }
  } catch {
    // Not a JSON body — fall through to the raw message.
  }
  return err.message || fallback;
};

const formatTimestamp = (iso?: string | null): string | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleString();
};

export const GoogleDriveSyncButton = ({
  document: doc,
  orgId,
  onSyncComplete,
  isPullDisabled = false,
  pullDisabledReason,
}: GoogleDriveSyncButtonProps) => {
  const { trigger: syncTo } = useSyncRFPDocumentToGoogleDrive(orgId);
  const { trigger: syncFrom } = useSyncRFPDocumentFromGoogleDrive(orgId);
  const { toast } = useToast();
  const { currentOrganization } = useCurrentOrganization();
  const [isSyncingTo, setIsSyncingTo] = useState(false);
  const [isSyncingFrom, setIsSyncingFrom] = useState(false);
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false);
  const [isOverrideConfirmOpen, setIsOverrideConfirmOpen] = useState(false);

  const hasContent = !!(doc.fileKey || doc.htmlContentKey);
  // The fileId is what makes an update-in-place possible, so it — not the URL —
  // decides whether the document is linked.
  const isSynced = !!doc.googleDriveFileId;
  const isBusy = isSyncingTo || isSyncingFrom;

  const settingsUrl = currentOrganization?.id
    ? `/organizations/${currentOrganization.id}/settings`
    : '/organizations';

  const lastPushed = formatTimestamp(doc.driveLastPushedAt);
  const lastPulled = formatTimestamp(doc.driveLastPulledAt);
  const isBlockedByApproval = doc.driveSyncStatus === 'BLOCKED_APPROVED';

  /**
   * Drive has moved on since our last push, so pushing would overwrite edits we
   * never pulled. Last-write-wins is the policy, but it should not be silent.
   */
  const hasUnpulledDriveChanges = (() => {
    if (!doc.driveModifiedTime || !doc.driveLastPushedAt) return false;
    const modified = Date.parse(doc.driveModifiedTime);
    const pushed = Date.parse(doc.driveLastPushedAt);
    if (Number.isNaN(modified) || Number.isNaN(pushed)) return false;
    return modified > pushed;
  })();

  const showNotConfiguredToast = useCallback(() => {
    toast({
      title: 'Google Drive not configured',
      description: 'Add a Google service account JSON key in Organization Settings to enable Drive sync.',
      variant: 'destructive',
      action: (
        <Link href={settingsUrl} className="underline text-xs font-medium whitespace-nowrap">
          Open Settings
        </Link>
      ),
    });
  }, [toast, settingsUrl]);

  const runSyncTo = useCallback(async () => {
    if (isBusy || !hasContent) return;
    try {
      setIsSyncingTo(true);
      const result = await syncTo({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
      });
      toast({
        title: result.updatedExisting ? 'Google Doc updated' : 'Synced to Google Drive',
        description: result.updatedExisting
          ? `"${doc.name}" was updated in place — no duplicate was created.`
          : `"${doc.name}" is now an editable Google Doc.`,
      });
      onSyncComplete?.();
    } catch (err) {
      if (isDriveNotConfiguredError(err)) {
        showNotConfiguredToast();
      } else {
        toast({
          title: 'Sync to Drive failed',
          description: readErrorMessage(err, 'Could not sync to Google Drive'),
          variant: 'destructive',
        });
      }
    } finally {
      setIsSyncingTo(false);
    }
  }, [isBusy, hasContent, syncTo, doc, toast, onSyncComplete, showNotConfiguredToast]);

  const handleSyncTo = useCallback(() => {
    if (hasUnpulledDriveChanges) {
      setIsOverwriteConfirmOpen(true);
      return;
    }
    void runSyncTo();
  }, [hasUnpulledDriveChanges, runSyncTo]);

  const runSyncFrom = useCallback(
    async (acceptApprovedOverride: boolean) => {
      // isPullDisabled is enforced here, not just on the menu item: Radix's `disabled`
      // suppresses activation through a CSS `pointer-events: none`, which does nothing
      // for a keyboard selection or a caller that reaches the handler directly.
      if (isBusy || !isSynced || isPullDisabled) return;
      try {
        setIsSyncingFrom(true);
        const result = await syncFrom({
          projectId: doc.projectId,
          opportunityId: doc.opportunityId,
          documentId: doc.documentId,
          ...(acceptApprovedOverride ? { acceptApprovedOverride: true } : {}),
        });

        // `changed: false` is a success — Drive has not moved since the last import,
        // and nothing was written. Reporting it as "Synced" would imply otherwise.
        if (!result.changed) {
          toast({
            title: 'Already up to date',
            description: `"${doc.name}" matches the Google Doc — nothing to import.`,
          });
        } else if (result.overrodeApproval) {
          toast({
            title: 'Imported — approval reopened',
            description: `"${doc.name}" was imported and its status returned to pending signature. Previous approvers have been notified.`,
          });
        } else if (result.notifiedPendingReviewers) {
          // The reviewer is mid-review, so the person importing should know their change
          // just moved the goalposts on someone else.
          toast({
            title: 'Imported — reviewer notified',
            description: `"${doc.name}" is out for review, so the reviewer has been told the content changed${
              result.versionNumber ? ` (now version ${result.versionNumber})` : ''
            }.`,
          });
        } else {
          toast({
            title: 'Synced from Google Drive',
            description: `"${doc.name}" was imported from Google Drive${
              result.versionNumber ? ` as version ${result.versionNumber}` : ''
            }.`,
          });
        }
        onSyncComplete?.();
      } catch (err) {
        if (isDriveNotConfiguredError(err)) {
          showNotConfiguredToast();
        } else {
          toast({
            title: 'Sync from Drive failed',
            description: readErrorMessage(err, 'Could not sync from Google Drive'),
            variant: 'destructive',
          });
        }
      } finally {
        setIsSyncingFrom(false);
      }
    },
    [
      isBusy,
      isSynced,
      isPullDisabled,
      syncFrom,
      doc,
      toast,
      onSyncComplete,
      showNotConfiguredToast,
    ],
  );

  const handleSyncFrom = useCallback(() => {
    void runSyncFrom(false);
  }, [runSyncFrom]);

  // Don't render if document is still generating or there's nothing to sync
  if (doc.status === 'GENERATING') return null;
  if (!hasContent && !isSynced) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PermissionButton
            requiredPermission="proposal:edit"
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
          </PermissionButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          {/* Open the native Google Doc — only when linked */}
          {isSynced && doc.googleDriveUrl && (
            <>
              <DropdownMenuItem asChild>
                <a
                  href={doc.googleDriveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  <span>Open in Google Doc</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Push to Drive */}
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
              <span>{isSynced ? 'Update Google Doc' : 'Push to Google Drive'}</span>
            </DropdownMenuItem>
          )}

          {/* Pull from Drive. Every import writes a version snapshot first, so a bad
              Drive edit stays recoverable from the version history sidebar. */}
          {isSynced && (
            <DropdownMenuItem
              onClick={handleSyncFrom}
              disabled={isBusy || isPullDisabled}
              className="flex items-center gap-2 cursor-pointer"
            >
              {isSyncingFrom ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Download className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="flex flex-col">
                <span>Pull from Google Drive</span>
                {isPullDisabled && pullDisabledReason && (
                  <span className="text-xs text-muted-foreground">{pullDisabledReason}</span>
                )}
              </span>
            </DropdownMenuItem>
          )}

          {/* The escape hatch for an approved document. Manual only — the poller must
              never reopen an approval on a user's behalf. */}
          {isSynced && isBlockedByApproval && (
            <DropdownMenuItem
              onClick={() => {
                if (isBusy || isPullDisabled) return;
                setIsOverrideConfirmOpen(true);
              }}
              disabled={isBusy || isPullDisabled}
              className="flex items-center gap-2 cursor-pointer text-amber-600 dark:text-amber-400 focus:text-amber-600"
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>Import anyway (reopens approval)</span>
            </DropdownMenuItem>
          )}

          {/* The frozen copy of what was approved. Separate from the live Doc above —
              this one is a record and is never re-synced. */}
          {doc.driveApprovedSnapshotUrl && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a
                  href={doc.driveApprovedSnapshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <FileCheck className="h-4 w-4 text-muted-foreground" />
                  <span className="flex flex-col">
                    <span>Open approved copy</span>
                    <span className="text-xs text-muted-foreground">
                      {doc.driveApprovedSnapshotVersion
                        ? `Frozen at version ${doc.driveApprovedSnapshotVersion}`
                        : 'Frozen record — not synced'}
                    </span>
                  </span>
                </a>
              </DropdownMenuItem>
            </>
          )}

          {/* Status block */}
          {(lastPushed || lastPulled || doc.driveSyncError || isBlockedByApproval) && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 space-y-1 text-xs text-muted-foreground">
                {lastPushed && <p>Last pushed {lastPushed}</p>}
                {lastPulled && <p>Last pulled {lastPulled}</p>}
                {isBlockedByApproval && (
                  <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span>Drive edits blocked — document approved</span>
                  </p>
                )}
                {doc.driveSyncError && !isBlockedByApproval && (
                  <p className="text-destructive break-words">{doc.driveSyncError}</p>
                )}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isOverwriteConfirmOpen} onOpenChange={setIsOverwriteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite newer Google Drive changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The Google Doc has been edited since AutoRFP last pushed to it. Pushing now replaces
              those Drive edits with the current AutoRFP content. They will remain in the Google Doc
              version history, but will not be imported here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runSyncTo()}>
              Push anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isOverrideConfirmOpen} onOpenChange={setIsOverrideConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import into an approved document?</AlertDialogTitle>
            <AlertDialogDescription>
              This document is approved, so Drive edits were held back rather than applied.
              Importing them replaces the approved content, returns the document to
              <span className="font-medium"> pending signature</span>, cancels its pending
              approvals, and notifies the previous approvers. The approved content stays
              available in the version history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runSyncFrom(true)}>
              Import and reopen approval
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
