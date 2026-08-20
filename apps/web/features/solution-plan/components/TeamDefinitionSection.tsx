'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, FileText, Pencil, RefreshCw, Sparkles, Users } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/use-toast';
import PermissionWrapper from '@/components/permission-wrapper';
import { useEmployees } from '@/features/employees';
import { useStaffingPlans } from '@/lib/hooks/use-pricing';
import type { ApiError } from '@/lib/hooks/api-helpers';
import type { PlanTeamMember } from '@auto-rfp/core';

import { usePlanTeam } from '../hooks/usePlanTeam';
import { useSavePlanTeam } from '../hooks/useSavePlanTeam';
import { useRegeneratePlanTeam } from '../hooks/useRegeneratePlanTeam';
import {
  useGenerateTeamQualifications,
  toTeamRequiredMessage,
} from '../hooks/useGenerateTeamQualifications';
import { TeamViewTable } from './TeamViewTable';
import { TeamEditTable, type DraftTeamMember } from './TeamEditTable';

interface TeamDefinitionSectionProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

/** Strip the local edit key and drop fields the line shape forbids (BR1.3). */
const toSavePayload = (drafts: DraftTeamMember[]): PlanTeamMember[] =>
  drafts.map((draft) => {
    const hasPerson = !!draft.employeeId;
    const isRemovedLine = !hasPerson && draft.removedEmployee && !!draft.nameSnapshot;
    return {
      role: draft.role.trim(),
      removedEmployee: isRemovedLine,
      source: draft.source,
      ...(hasPerson ? { employeeId: draft.employeeId, nameSnapshot: draft.nameSnapshot } : {}),
      ...(isRemovedLine ? { nameSnapshot: draft.nameSnapshot } : {}),
      ...((hasPerson || isRemovedLine) && draft.rationale ? { rationale: draft.rationale } : {}),
      ...(draft.staffingPositionRef ? { staffingPositionRef: draft.staffingPositionRef } : {}),
    };
  });

/**
 * The Team Definition section of the solution plan (U3): renders the
 * AI-recommended, human-correctable team (W2), in-place editing with
 * Save/Cancel (W3, BR3.1), explicit regenerate with confirmation (W4), the
 * empty-pool prerequisite state (BR4.1) and the matching-failure state with
 * retry while manual assembly stays available (BR4.2).
 */
export const TeamDefinitionSection = ({
  orgId,
  projectId,
  opportunityId,
}: TeamDefinitionSectionProps) => {
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const { team, isLoading, notFound, refresh } = usePlanTeam(orgId, projectId, opportunityId);
  const { employees, isLoading: isPoolLoading } = useEmployees(orgId);
  const { data: staffingData } = useStaffingPlans(orgId, projectId, opportunityId);
  const { savePlanTeam, isSaving } = useSavePlanTeam(orgId, projectId, opportunityId);
  const { regeneratePlanTeam, isRegenerating } = useRegeneratePlanTeam(
    orgId,
    projectId,
    opportunityId,
  );
  const {
    generateTeamQualifications,
    isGenerating: isGeneratingQualifications,
    teamQualificationsDocument,
  } = useGenerateTeamQualifications(orgId, projectId, opportunityId);

  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState<DraftTeamMember[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const draftKeyCounter = useRef(0);

  const nextKey = () => `draft-${draftKeyCounter.current++}`;

  // Role suggestions come from the most recently updated staffing plan (BR2.1).
  const staffingPlans = staffingData?.staffingPlans ?? [];
  const latestPlan = [...staffingPlans].sort((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )[0];
  const roleSuggestions = [...new Set(latestPlan?.laborItems.map((item) => item.position) ?? [])];

  const isEmptyPool = !isPoolLoading && employees.length === 0;
  const isBusy = isSaving || isRegenerating;

  // ── Edit mode ──

  const handleStartEditing = useCallback(
    (members: PlanTeamMember[]) => {
      setDrafts(members.map((member) => ({ ...member, _key: nextKey() })));
      setIsEditing(true);
    },
    [],
  );

  const handleChangeMember = (key: string, patch: Partial<PlanTeamMember>) =>
    setDrafts((prev) => prev.map((d) => (d._key === key ? { ...d, ...patch } : d)));

  const handleRemoveMember = (key: string) =>
    setDrafts((prev) => prev.filter((d) => d._key !== key));

  const handleAddMember = () =>
    setDrafts((prev) => [
      ...prev,
      { _key: nextKey(), role: '', removedEmployee: false, source: 'MANUAL' },
    ]);

  const handleCancel = () => {
    // BR3.1 — Cancel discards all edits; the last persisted team re-renders.
    setIsEditing(false);
    setDrafts([]);
  };

  const handleSave = async () => {
    if (drafts.some((d) => !d.role.trim())) {
      toast({
        title: 'Every team line needs a role',
        description: 'Fill in the role or remove the empty line before saving.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await savePlanTeam({ members: toSavePayload(drafts) });
      await refresh();
      setIsEditing(false);
      setDrafts([]);
      toast({
        title: 'Team saved',
        description: 'The saved team is what generated documents will use.',
      });
    } catch (err) {
      toast({
        title: 'Could not save the team',
        description: (err as ApiError).message,
        variant: 'destructive',
      });
    }
  };

  // ── Generate / regenerate (W4) ──

  const runRegenerate = useCallback(async () => {
    setGenerationError(null);
    try {
      const result = await regeneratePlanTeam();
      await refresh();
      if (result?.emptyPool) return;
      toast({ title: 'Team recommendation ready' });
    } catch (err) {
      // BR4.2 — the existing team is untouched; show retry, keep edit available.
      setGenerationError((err as ApiError).message);
    }
  }, [regeneratePlanTeam, refresh, toast]);

  // ── Team Qualifications generation (U4, FR4.2/FR4.3) ──

  // BR1.1's "saved team": a persisted team with at least one member.
  const hasSavedTeam = !!team && team.members.length > 0;

  const handleGenerateQualifications = async () => {
    try {
      await generateTeamQualifications();
      toast({
        title: 'Team Qualifications generation started',
        description: 'The document will appear among this opportunity’s documents when ready.',
      });
    } catch (err) {
      // FR4.2 — the saved-team refusal is guidance, not a failure.
      const teamRequiredMessage = toTeamRequiredMessage(err);
      toast({
        title: teamRequiredMessage
          ? 'Save the team first'
          : 'Could not start Team Qualifications generation',
        description: teamRequiredMessage ?? (err as ApiError).message,
        variant: 'destructive',
      });
    }
  };

  const handleRegenerate = async () => {
    if (team) {
      const confirmed = await confirm({
        title: 'Regenerate team?',
        description: team.userModified
          ? 'A fresh AI recommendation will replace the current team, including your manual changes.'
          : 'A fresh AI recommendation will replace the current team.',
        confirmLabel: 'Regenerate',
        variant: team.userModified ? 'destructive' : 'default',
      });
      if (!confirmed) return;
    }
    await runRegenerate();
  };

  // ── Render ──

  if (notFound) return null;

  const renderBody = () => {
    if (isLoading || isPoolLoading) {
      return (
        <div className="space-y-2" data-testid="team-definition-skeleton">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      );
    }

    if (isEditing) {
      return (
        <div className="space-y-3">
          <TeamEditTable
            drafts={drafts}
            employees={employees}
            roleSuggestions={roleSuggestions}
            onChangeMember={handleChangeMember}
            onRemoveMember={handleRemoveMember}
            onAddMember={handleAddMember}
            disabled={isBusy}
          />
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={isBusy} data-testid="team-save">
              Save
            </Button>
            <Button variant="outline" onClick={handleCancel} disabled={isBusy} data-testid="team-cancel">
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    // BR4.1 — empty pool: prerequisite, not an error; manual assembly stays
    // unavailable until employees exist.
    if (isEmptyPool && !team) {
      return (
        <Alert data-testid="team-empty-pool">
          <Users className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Add your employees before a team can be recommended — the pool is empty.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/organizations/${orgId}/employees`}>Go to the Team page</Link>
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="space-y-3">
        {generationError && (
          <Alert variant="destructive" data-testid="team-generation-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>Team recommendation failed: {generationError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runRegenerate()}
                disabled={isBusy}
                data-testid="team-retry"
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {team ? (
          <>
            <TeamViewTable members={team.members} />
            {team.userModified && (
              <p className="text-xs text-muted-foreground">
                Manually edited — this team survives plan regenerations.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="team-not-generated">
            No team yet. Generate a recommendation from your employee pool, or build the team
            by hand.
          </p>
        )}

        <PermissionWrapper requiredPermission="proposal:create">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEditing(team?.members ?? [])}
              disabled={isBusy}
              data-testid="team-edit"
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {team ? 'Edit team' : 'Build manually'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRegenerate()}
              disabled={isBusy}
              data-testid="team-regenerate"
            >
              {team ? (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              {team ? 'Regenerate team' : 'Generate team'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleGenerateQualifications()}
              disabled={isBusy || isGeneratingQualifications || !hasSavedTeam}
              title={
                hasSavedTeam
                  ? undefined
                  : 'Review and save the team before generating Team Qualifications.'
              }
              data-testid="team-generate-qualifications"
            >
              <FileText className="mr-1.5 h-4 w-4" />
              {isGeneratingQualifications
                ? 'Generating Team Qualifications…'
                : 'Generate Team Qualifications'}
            </Button>
            {teamQualificationsDocument?.status === 'READY' && (
              <Button variant="ghost" size="sm" asChild data-testid="team-qualifications-view">
                <Link
                  href={`/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/rfp-documents/${teamQualificationsDocument.documentId}`}
                >
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  View Team Qualifications
                </Link>
              </Button>
            )}
          </div>
          {!hasSavedTeam && (
            <p className="text-xs text-muted-foreground" data-testid="team-qualifications-guidance">
              Team Qualifications can be generated once the team above is saved.
            </p>
          )}
        </PermissionWrapper>
      </div>
    );
  };

  return (
    <div className="border-t pt-4 mt-4 space-y-3" data-testid="team-definition-section">
      <div>
        <h3 className="text-sm font-semibold">Team Definition</h3>
        <p className="text-sm text-muted-foreground">
          The recommended team for this plan — generated from your employee pool, editable in
          place, and used by generated documents.
        </p>
      </div>
      {renderBody()}
      <ConfirmDialog />
    </div>
  );
};
