'use client';

import { useState } from 'react';
import { ChevronDown, History, Loader2, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { RequiredFormVersionSource } from '@auto-rfp/core';

import { useFormVersions } from '../hooks/useFormVersions';
import { computeFormFieldDiff, type FieldChange } from '../lib/formFieldDiff';

interface FormVersionHistoryProps {
  orgId: string;
  projectId: string;
  oppId: string;
  formId: string;
  /** Called after a successful revert so the form editor can reload fields. */
  onReverted?: () => void;
}

const SOURCE_LABEL: Record<RequiredFormVersionSource, string> = {
  MANUAL: 'Manual edit',
  AI_MASS_EDIT: 'AI mass edit',
  AI_FILL: 'AI fill',
  SYSTEM: 'System',
};

const emptyText = <span className="italic text-gray-400">(empty)</span>;

// Note: the form editors pin their sidebar to a LIGHT surface (bg-white /
// bg-gray-50) in both themes, so this panel uses explicit gray-scale colors
// rather than theme tokens — otherwise the text/buttons render near-white and
// vanish in dark mode.
const ChangeRow = ({ change }: { change: FieldChange }) => (
  <li className="rounded border border-gray-200 bg-white px-2 py-1.5">
    <p className="text-[11px] font-medium text-gray-600 truncate">{change.label}</p>
    <div className="mt-0.5 flex items-start gap-1.5 text-xs">
      <span className="rounded bg-red-100 px-1 text-red-800 line-through decoration-red-400 break-words">
        {change.current ? change.current : emptyText}
      </span>
      <span className="text-gray-400">→</span>
      <span className="rounded bg-green-100 px-1 text-green-800 break-words">
        {change.restored ? change.restored : emptyText}
      </span>
    </div>
  </li>
);

/**
 * Version list + revert affordance for a required form (a tab in the editor
 * sidebar). Each row shows a prior snapshot; expanding it previews exactly which
 * fields restoring would change (diff vs the current form), before you commit.
 */
export const FormVersionHistory = ({
  orgId,
  projectId,
  oppId,
  formId,
  onReverted,
}: FormVersionHistoryProps) => {
  const {
    versions,
    currentFields,
    hasCurrentFields,
    isLoadingForm,
    formError,
    isLoading,
    revert,
  } = useFormVersions(orgId, projectId, oppId, formId);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

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
        const isOpen = expanded === version.versionNumber;
        const isReverting = revertingVersion === version.versionNumber;
        // Only diff against a REAL current baseline. Diffing against the
        // []-while-loading placeholder would render every field as "added" and
        // misstate this destructive restore, so gate on hasCurrentFields.
        const changes = isOpen && hasCurrentFields ? computeFormFieldDiff(currentFields, version.fields) : [];
        return (
          <li key={version.versionId} className="rounded-md border border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setExpanded(isOpen ? null : version.versionNumber)}
                // Disclosure toggle; keep the borderless left-aligned row styling.
                className="h-auto flex min-w-0 items-center gap-2 rounded-none p-0 text-left hover:bg-transparent"
                aria-expanded={isOpen}
              >
                <ChevronDown
                  className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')}
                />
                <span className="text-sm font-semibold text-gray-900">v{version.versionNumber}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  {SOURCE_LABEL[version.source]}
                </span>
              </Button>
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

            {version.changeNote && (
              <p className="px-3 pb-1 text-xs text-gray-500">{version.changeNote}</p>
            )}

            {isOpen && (
              <div className="border-t border-gray-100 px-3 py-2">
                {formError ? (
                  // Can't diff without the current form — never imply a change count
                  // we can't compute for a destructive action.
                  <p className="text-[11px] font-medium text-red-700">
                    Couldn&apos;t load the current form, so changes can&apos;t be previewed. You can still restore, but review the form afterward.
                  </p>
                ) : !hasCurrentFields || isLoadingForm ? (
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : (
                  <>
                    <p className="mb-1.5 text-[11px] font-medium text-gray-500">
                      Restoring this version would {changes.length === 0 ? 'make no changes' : `change ${changes.length} field${changes.length === 1 ? '' : 's'}`}:
                    </p>
                    {changes.length > 0 && (
                      <ul className="space-y-1">
                        {changes.map((c, i) => (
                          // fieldId alone isn't guaranteed unique (a form's fields
                          // can repeat an id, yielding same-id changes) → compose
                          // with kind + index so React keys never collide.
                          <ChangeRow key={`${c.fieldId}-${c.kind}-${i}`} change={c} />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
