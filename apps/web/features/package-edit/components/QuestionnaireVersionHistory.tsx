'use client';

import { useState } from 'react';
import { History, Loader2, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { QuestionnaireVersionSource } from '@auto-rfp/core';

import { useQuestionnaireVersions } from '../hooks/useQuestionnaireVersions';

interface QuestionnaireVersionHistoryProps {
  orgId: string;
  projectId: string;
  oppId: string;
  documentId: string;
  /** Called after a successful revert so the editor can reload the workbook. */
  onReverted?: () => void;
}

const SOURCE_LABEL: Record<QuestionnaireVersionSource, string> = {
  MANUAL: 'Manual edit',
  AI_MASS_EDIT: 'AI mass edit',
  SYSTEM: 'System',
};

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/**
 * Version list + restore for a file-based XLSX questionnaire (a tab in the
 * editor sidebar). A snapshot is the whole .xlsx, so — unlike the form history —
 * there is no per-field diff; restoring replaces the live file wholesale and the
 * editor reloads it.
 *
 * Uses explicit gray-scale colors (not theme tokens) to match FormVersionHistory,
 * which shares this light-surface sidebar treatment for dark-mode legibility.
 */
export const QuestionnaireVersionHistory = ({
  orgId,
  projectId,
  oppId,
  documentId,
  onReverted,
}: QuestionnaireVersionHistoryProps) => {
  const { versions, isLoading, revert } = useQuestionnaireVersions(orgId, projectId, oppId, documentId);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);

  const handleRevert = async (targetVersion: number) => {
    setRevertingVersion(targetVersion);
    try {
      await revert(targetVersion);
      onReverted?.();
    } finally {
      setRevertingVersion(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-gray-500">
        <History className="h-4 w-4" /> No version history yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {versions.map((version) => {
        const isReverting = revertingVersion === version.versionNumber;
        return (
          <li key={version.versionId} className="rounded-md border border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">v{version.versionNumber}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  {SOURCE_LABEL[version.source]}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleRevert(version.versionNumber)}
                disabled={revertingVersion !== null}
                // Explicit gray-scale (light surface in both themes) preserved over
                // the outline variant's theme tokens via tailwind-merge.
                className="h-auto gap-1 border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-700"
              >
                {isReverting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Undo2 className="h-3.5 w-3.5" />
                )}
                Restore
              </Button>
            </div>
            <p className="px-3 pb-1.5 text-[11px] text-gray-500">
              {formatWhen(version.createdAt)}
              {version.createdByName ? ` · ${version.createdByName}` : ''}
              {version.changeNote ? ` · ${version.changeNote}` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
};
