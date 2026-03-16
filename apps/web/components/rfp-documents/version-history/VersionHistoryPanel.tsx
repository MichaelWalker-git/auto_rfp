'use client';

import { useState } from 'react';
import { History, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { VersionListItem } from './VersionListItem';
import { useDocumentVersions } from '@/lib/hooks/use-document-versions';
import type { RFPDocumentVersion } from '@auto-rfp/core';

interface VersionHistoryPanelProps {
  projectId: string;
  opportunityId: string;
  documentId: string;
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  onCompare: (fromVersion: number, toVersion: number) => void;
  onRevert: (version: RFPDocumentVersion) => void;
}

export const VersionHistoryPanel = ({
  projectId,
  opportunityId,
  documentId,
  orgId,
  isOpen,
  onClose,
  onCompare,
  onRevert,
}: VersionHistoryPanelProps) => {
  const { data, isLoading, error } = useDocumentVersions(
    projectId,
    opportunityId,
    documentId,
    orgId,
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  if (!isOpen) return null;

  const versions = data?.items ?? [];
  const latestVersion = versions[0];

  const handleCompare = (version: RFPDocumentVersion) => {
    if (latestVersion) {
      onCompare(version.versionNumber, latestVersion.versionNumber);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Content */}
      <ScrollArea className="flex-1 p-6 min-h-0 [&>div>div]:!block">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-3 border rounded-lg">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-3 w-full mb-2" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>Failed to load version history</p>
            <p className="text-sm">{error.message}</p>
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No version history</p>
            <p className="text-sm">Versions are created when you save changes</p>
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((version, index) => (
              <VersionListItem
                key={version.versionId}
                version={version}
                isLatest={index === 0}
                isSelected={selectedVersionId === version.versionId}
                onSelect={() => setSelectedVersionId(version.versionId)}
                onCompare={() => handleCompare(version)}
                onRevert={() => onRevert(version)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      {versions.length > 0 && (
        <div className="p-4 border-t text-xs text-muted-foreground text-center">
          {versions.length} version{versions.length !== 1 ? 's' : ''} available
        </div>
      )}
    </div>
  );
};
