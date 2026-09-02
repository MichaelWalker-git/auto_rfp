export { SolutionPlanPanel } from './components/SolutionPlanPanel';
export {
  SolutionPlanGateCallout,
  SolutionPlanNudgeBanner,
  SOLUTION_PLAN_GATE_BLOCKED_LABEL,
  buildSolutionPlanSectionHref,
} from './components/SolutionPlanGateCallout';
export { SolutionPlanEditorPage } from './components/SolutionPlanEditorPage';
export { GrillingTranscriptView } from './components/GrillingTranscriptView';
export { SolutionPlanStatusBadge } from './components/SolutionPlanStatusBadge';
export { useSolutionPlan, SOLUTION_PLAN_POLL_INTERVAL_MS } from './hooks/useSolutionPlan';
export { useGrillingTranscript } from './hooks/useGrillingTranscript';
export { useSolutionPlanHtmlContent } from './hooks/useSolutionPlanHtmlContent';
export { useInitSolutionPlan } from './hooks/useInitSolutionPlan';
export { useSolutionPlanActions } from './hooks/useSolutionPlanActions';
export { useUpdateSolutionPlan } from './hooks/useUpdateSolutionPlan';
export { useSolutionPlanGate, type SolutionPlanGate } from './hooks/useSolutionPlanGate';
export { TeamDefinitionSection } from './components/TeamDefinitionSection';
export { TeamViewTable } from './components/TeamViewTable';
export { TeamEditTable, type DraftTeamMember } from './components/TeamEditTable';
export { usePlanTeam, planTeamKey } from './hooks/usePlanTeam';
export { useSavePlanTeam } from './hooks/useSavePlanTeam';
export { useRegeneratePlanTeam } from './hooks/useRegeneratePlanTeam';
export {
  useGenerateTeamQualifications,
  toTeamRequiredMessage,
  TEAM_REQUIRED_MESSAGE,
} from './hooks/useGenerateTeamQualifications';
export { canGenerateDocuments, isSolutionPlanRunning } from './lib/status';
// ── Version history (solution-plan-versioning u4) ──
export { VersionHistoryControl } from './components/VersionHistoryControl';
export { VersionDropdown, VersionDropdownItem } from './components/VersionDropdown';
export {
  VersionHistoryPanel,
  VersionRow,
  VersionListSkeleton,
  VersionListEmpty,
  VersionListError,
} from './components/VersionHistoryPanel';
export { VersionViewModal } from './components/VersionViewModal';
export { RestoreConfirmDialog } from './components/RestoreConfirmDialog';
export { DeleteConfirmDialog } from './components/DeleteConfirmDialog';
export { LabelInlineEditor } from './components/LabelInlineEditor';
export { useVersionList, versionListKey } from './hooks/useVersionList';
export { useVersionContent } from './hooks/useVersionContent';
export { useVersionLabel, type VersionLabelSaveResult } from './hooks/useVersionLabel';
export { useVersionDelete, type VersionDeleteResult } from './hooks/useVersionDelete';
export { useVersionRestore, type VersionRestoreResult } from './hooks/useVersionRestore';
export { hasGrandfatheredDocument, isGeneratedDocument } from './lib/gating';
