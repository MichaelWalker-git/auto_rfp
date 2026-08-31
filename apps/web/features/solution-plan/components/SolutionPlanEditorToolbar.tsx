'use client';

import Link from 'next/link';
import { ArrowLeft, Loader2, RefreshCw, Save, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import PermissionWrapper from '@/components/permission-wrapper';
import type { SolutionPlanItem } from '@auto-rfp/core';
import { SolutionPlanStatusBadge } from './SolutionPlanStatusBadge';

interface SolutionPlanEditorToolbarProps {
  plan: SolutionPlanItem;
  backUrl: string;
  isRegenerateStarting: boolean;
  isSaving: boolean;
  isBusy: boolean;
  canSave: boolean;
  onRegenerate: () => void;
  onSave: () => void;
  /**
   * The version-history control (VersionHistoryControl) — replaces the
   * static "Version {n}" text when provided. Passed in as a node so this
   * toolbar stays pure presentation.
   */
  versionControl?: React.ReactNode;
}

/** Icon-or-spinner button body shared by the Regenerate and Save actions. */
const ActionLabel = ({
  isBusy,
  busyLabel,
  icon: Icon,
  label,
}: {
  isBusy: boolean;
  busyLabel: string;
  icon: LucideIcon;
  label: string;
}) =>
  isBusy ? (
    <>
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      {busyLabel}
    </>
  ) : (
    <>
      <Icon className="h-4 w-4 mr-2" />
      {label}
    </>
  );

/** Top toolbar of the Solution Plan editor: back link, status, and actions. */
export const SolutionPlanEditorToolbar = ({
  plan,
  backUrl,
  isRegenerateStarting,
  isSaving,
  isBusy,
  canSave,
  onRegenerate,
  onSave,
  versionControl,
}: SolutionPlanEditorToolbarProps) => (
  <div className="flex items-center gap-2 px-4 py-2 border-b bg-background shrink-0">
    <Button
      variant="ghost"
      size="sm"
      className="gap-1 text-muted-foreground hover:text-foreground px-2 shrink-0"
      asChild
    >
      <Link href={backUrl}>
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
    </Button>

    <span className="text-sm font-medium shrink-0">Solution Plan</span>
    <SolutionPlanStatusBadge status={plan.status} />
    {versionControl ?? (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        Version {plan.version}
      </span>
    )}
    {plan.isUserEdited && (
      <span className="text-xs text-muted-foreground whitespace-nowrap">manually edited</span>
    )}

    <div className="flex-1" />

    <div className="flex items-center gap-2 shrink-0">
      <PermissionWrapper requiredPermission="proposal:create">
        <Button
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={isBusy}
          title={
            plan.isUserEdited
              ? 'Regenerating permanently discards manual edits'
              : 'Run a new interview and replace this plan'
          }
        >
          <ActionLabel
            isBusy={isRegenerateStarting}
            busyLabel="Starting…"
            icon={RefreshCw}
            label="Regenerate"
          />
        </Button>
      </PermissionWrapper>

      <PermissionWrapper requiredPermission="proposal:create">
        <Button size="sm" onClick={onSave} disabled={isBusy || !canSave}>
          <ActionLabel isBusy={isSaving} busyLabel="Saving…" icon={Save} label="Save" />
        </Button>
      </PermissionWrapper>
    </div>
  </div>
);
