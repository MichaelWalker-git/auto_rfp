'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Save, Sparkles, MessageSquare, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { AnswerSource, type AnswerResolution, ConfidenceBreakdown, ConfidenceBand, type CommentEntityType, type QuestionOption, type QuestionResponseKind } from '@auto-rfp/core';
import { PermissionButton } from '@/components/ui/permission-button';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { ConfidenceScoreDisplay } from '@/components/confidence/confidence-score-display';
import { SimilarQuestionsPanel } from './similar-questions-panel';
import { getToolDisplayName } from './source-details-dialog';
import { CollaborationPanel, FloatingPanel } from '@/features/collaboration';
import { useComments } from '@/features/collaboration/hooks/useComments';
import { AiNotConfiguredNotice } from '@/components/ai-not-configured-notice';

interface AnswerData {
  text: string;
  /** The text that was last approved (used to detect if local edits match approved state) */
  approvedText?: string;
  sources?: AnswerSource[];
  confidence?: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: ConfidenceBand;
  /** Why the answer is in its current state (e.g. NO_KB_MATCH) */
  resolution?: AnswerResolution;
  // Edit tracking
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: string;
  // Approval tracking
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  status?: string;
}

interface CollaborationProps {
  orgId?: string;
  currentUserId?: string;
  editingUsers?: import('@auto-rfp/core').PresenceItem[];
  canComment?: boolean;
  questionEntityPk?: string;
  questionEntitySk?: string;
}

interface QuestionEditorProps {
  question: any;
  section: any;
  answer: AnswerData | undefined;
  selectedIndexes: Set<string>;
  isUnsaved: boolean;
  isSaving: boolean;
  isGenerating: boolean;
  isApproving?: boolean;
  onUnapprove?: () => void;
  isUnapproving?: boolean;
  onAnswerChange: (value: string) => void;
  onSave: () => void;
  onApprove: () => void;
  onGenerateAnswer: () => void;
  onSourceClick: (source: AnswerSource) => void;
  onRemoveQuestion: () => void;
  isRemoving?: boolean;
  projectId?: string;
  onSelectQuestion?: (questionId: string) => void;
  onAnswerApplied?: (targetQuestionIds: string[], answerText: string) => void;
  collaboration?: CollaborationProps;
  /** Live answer text from another collaborator */
  liveAnswerText?: string;
}

/**
 * Status badge configuration for answer states.
 * - APPROVED: Green badge indicating the answer has been reviewed and approved
 * - DRAFT: Gray badge indicating the answer is still being worked on
 */
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DRAFT:    { label: 'Draft',    className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/** Delimiter used to serialize multiple selected options into the answer text. */
const MULTI_CHOICE_DELIMITER = '\n';

/**
 * Renders a radio group (SINGLE_CHOICE) or checkbox list (MULTI_CHOICE) for a
 * question that carries answer options. The selection is serialized back into
 * the same free-text answer channel every question already uses:
 *   - SINGLE_CHOICE → the chosen option's label
 *   - MULTI_CHOICE  → the chosen labels joined by newlines
 * so downstream storage, generation, and export keep treating the answer as
 * text. Falls back to a plain textarea when there are no usable options.
 */
const ChoiceAnswer = ({
  responseKind,
  options,
  value,
  onChange,
  disabled,
}: {
  responseKind: QuestionResponseKind;
  options: QuestionOption[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) => {
  // Selections serialize into the answer text — anything that isn't an exact
  // option label (e.g. AI-generated prose written before options were known)
  // can't survive a single toggle, so we surface it as a replaceable warning
  // rather than letting the first click silently overwrite invisible text.
  const optionLabels = new Set(options.map((o) => o.label));
  const selectedLabels = value
    .split(MULTI_CHOICE_DELIMITER)
    .map((s) => s.trim())
    .filter(Boolean);
  const hasUnmatchedText =
    value.trim().length > 0 && !selectedLabels.every((s) => optionLabels.has(s));

  const unmatchedNotice = hasUnmatchedText ? (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
      <p className="font-medium text-amber-900">
        This answer doesn&apos;t match the available options — selecting one will replace it.
      </p>
      <p className="mt-1 whitespace-pre-wrap text-slate-700">{value}</p>
    </div>
  ) : null;

  if (responseKind === 'SINGLE_CHOICE') {
    return (
      <>
        {unmatchedNotice}
        <RadioGroup value={value} onValueChange={onChange} disabled={disabled} className="gap-2">
          {options.map((opt, i) => {
            const id = `choice-${i}`;
            return (
              <div key={id} className="flex items-center gap-2">
                <RadioGroupItem value={opt.label} id={id} />
                <Label htmlFor={id} className="font-normal cursor-pointer">
                  {opt.label}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </>
    );
  }

  // MULTI_CHOICE — selected labels are the answer text split on the delimiter.
  const selected = new Set(selectedLabels);

  const handleToggle = (label: string, checked: boolean) => {
    // When the stored text is unmatched prose, the first toggle replaces it
    // entirely (there are no prior valid selections to preserve).
    const next = new Set(hasUnmatchedText ? [] : selected);
    if (checked) next.add(label);
    else next.delete(label);
    // Preserve the option order rather than Set insertion order.
    const ordered = options.map((o) => o.label).filter((l) => next.has(l));
    onChange(ordered.join(MULTI_CHOICE_DELIMITER));
  };

  return (
    <>
      {unmatchedNotice}
      <div className="grid gap-2">
        {options.map((opt, i) => {
          const id = `choice-${i}`;
          return (
            <div key={id} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={!hasUnmatchedText && selected.has(opt.label)}
                onCheckedChange={(checked) => handleToggle(opt.label, checked === true)}
                disabled={disabled}
              />
              <Label htmlFor={id} className="font-normal cursor-pointer">
                {opt.label}
              </Label>
            </div>
          );
        })}
      </div>
    </>
  );
};

export function QuestionEditor({
  question,
  section,
  answer,
  selectedIndexes,
  isUnsaved,
  isSaving,
  isGenerating,
  isApproving = false,
  onUnapprove,
  isUnapproving = false,
  onAnswerChange,
  onSave,
  onApprove,
  onGenerateAnswer,
  onSourceClick,
  onRemoveQuestion,
  isRemoving = false,
  projectId,
  onSelectQuestion,
  onAnswerApplied,
  collaboration,
  liveAnswerText,
}: QuestionEditorProps) {
  const [showComments, setShowComments] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [confidenceExpanded, setConfidenceExpanded] = useState(false);
  const routeParams = useParams<{ orgId?: string }>();
  const orgId = collaboration?.orgId ?? routeParams?.orgId ?? '';

  // Fetch unresolved comment count for the badge — only when collaboration is available
  const { unresolvedCount } = useComments(
    projectId ?? '',
    collaboration?.orgId ?? '',
    'QUESTION',
    question?.id ?? '',
  );

  const editors = collaboration?.editingUsers ?? [];
  // A multiple-choice question renders options instead of a textarea — but only
  // when it actually carries options; otherwise degrade to free-text.
  const isChoiceQuestion =
    (question?.responseKind === 'SINGLE_CHOICE' || question?.responseKind === 'MULTI_CHOICE') &&
    Array.isArray(question?.options) &&
    question.options.length > 0;
  const hasSources = answer?.sources && answer.sources.length > 0;
  const hasConfidence = answer?.confidence !== undefined && answer.confidence !== null;

  // The AI ran but found nothing in the knowledge base. Only surface these while
  // the answer is still empty — once a human types an answer, the notice is moot.
  const hasAnswerText = !!answer?.text && answer.text.trim().length > 0;
  const showNoKbMatchNotice = answer?.resolution === 'NO_KB_MATCH' && !hasAnswerText;
  // Generation errored/timed out before producing text — distinct from "searched
  // and found nothing": this one is retryable, so prompt a retry rather than
  // implying the knowledge base lacks the content.
  const showGenerationFailedNotice = answer?.resolution === 'GENERATION_FAILED' && !hasAnswerText;
  // The org has no valid Bedrock key — generation could not run at all. Distinct
  // from a generation failure: an admin must add a key, so point them there.
  const showAiNotConfiguredNotice = answer?.resolution === 'AI_NOT_CONFIGURED' && !hasAnswerText;

  // Status derived from answer — someone else editing = "Editing"
  const isBeingEditedByOther = editors.length > 0;
  const editorNames = editors.map((e) => e.displayName ?? 'Someone');
  const answerStatus = answer?.status ?? 'DRAFT';
  const statusConfig = isBeingEditedByOther
    ? { label: `${editorNames.join(', ')} ${editors.length === 1 ? 'is' : 'are'} editing…`, className: 'bg-amber-50 text-amber-700 border-amber-200' }
    : STATUS_CONFIG[answerStatus] ?? STATUS_CONFIG['DRAFT']!;

  // When another user is editing, disable all mutating actions
  const isLockedByOther = isBeingEditedByOther;

  return (
    <div className="flex gap-3">
      <Card className="flex-1 min-w-0">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-2">
              <CardTitle className="text-base">{section.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{question.question}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Answer status badge */}
              {answer?.text && (
                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${statusConfig.className}`}>
                  {isBeingEditedByOther && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse mr-1" />
                  )}
                  {statusConfig.label}
                </span>
              )}
              {isUnsaved && (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 text-xs">
                  Unsaved
                </Badge>
              )}
              {projectId && collaboration?.orgId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative gap-1 text-slate-500 h-7 px-2"
                  onClick={() => setShowComments((v) => !v)}
                  title={showComments ? 'Hide comments' : 'Show comments'}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="text-xs">Comments</span>
                  {unresolvedCount > 0 && (
                    <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-indigo-500 text-white text-[10px] font-bold leading-none">
                      {unresolvedCount > 99 ? '99+' : unresolvedCount}
                    </span>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Editing lock banner — shown when someone else is editing */}
          {isLockedByOther && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span className="text-amber-800">
                <strong>{editorNames.join(', ')}</strong> {editors.length === 1 ? 'is' : 'are'} currently editing this answer. The textarea and actions are locked until they finish.
              </span>
            </div>
          )}

          {/* No-KB-match notice — the AI searched but found nothing in the knowledge base */}
          {showNoKbMatchNotice && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-amber-800">
                <strong>Couldn&apos;t answer from the knowledge base.</strong> No supporting
                content was found for this question. Answer it manually below, or add relevant
                documents to the knowledge base and regenerate.
              </div>
            </div>
          )}

          {/* Generation-failed notice — generation errored or timed out before producing an answer */}
          {showGenerationFailedNotice && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm">
              <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <div className="text-red-800">
                <strong>Answer generation failed.</strong> Something went wrong while generating
                this answer. Click <strong>Generate</strong> to try again, or answer it manually below.
              </div>
            </div>
          )}

          {/* AI-not-configured notice — the org has no valid Bedrock key */}
          {showAiNotConfiguredNotice && <AiNotConfiguredNotice orgId={orgId} />}

          {/* Answer input — a radio group / checkbox list for multiple-choice
              questions, otherwise the free-text textarea. Choice questions must
              have usable options; if none arrived, fall back to text. */}
          {isChoiceQuestion ? (
            <div
              className={`rounded-lg border p-3 transition-shadow ${
                isLockedByOther ? 'ring-2 ring-amber-400 ring-offset-1 opacity-70' : ''
              }`}
            >
              <ChoiceAnswer
                responseKind={question.responseKind}
                options={question.options}
                value={answer?.text || ''}
                onChange={onAnswerChange}
                disabled={isLockedByOther}
              />
            </div>
          ) : (
            <Textarea
              placeholder="Enter your answer here..."
              className={`min-h-[200px] transition-shadow ${
                isLockedByOther
                  ? 'ring-2 ring-amber-400 ring-offset-1 focus-visible:ring-amber-400 opacity-70 cursor-not-allowed'
                  : ''
              }`}
              value={answer?.text || ''}
              onChange={(e) => onAnswerChange(e.target.value)}
              disabled={isLockedByOther}
            />
          )}

          {/* Live answer preview from collaborator */}
          {liveAnswerText !== undefined && liveAnswerText !== (answer?.text ?? '') && editors.length > 0 && (
            <div className="border border-amber-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs text-amber-700 font-medium">
                  {editors[0]?.displayName ?? 'Collaborator'} is editing…
                </span>
              </div>
              <div className="px-3 py-2 text-sm text-slate-600 whitespace-pre-wrap max-h-32 overflow-y-auto bg-amber-50/30">
                {liveAnswerText || <span className="text-slate-400 italic">Clearing answer…</span>}
              </div>
            </div>
          )}

          {/* Collapsible Confidence */}
          {hasConfidence && (
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                onClick={() => setConfidenceExpanded((v) => !v)}
              >
                {confidenceExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                <span className="text-xs font-medium text-slate-600">Confidence</span>
                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ml-1 ${
                  answer.confidenceBand === 'high' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : answer.confidenceBand === 'medium' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {Math.round((answer.confidence ?? 0) * 100)}%
                </span>
              </button>
              {confidenceExpanded && (
                <div className="px-3 pb-3 pt-2">
                  <ConfidenceScoreDisplay
                    confidence={answer.confidence!}
                    breakdown={answer.confidenceBreakdown}
                    band={answer.confidenceBand}
                  />
                </div>
              )}
            </div>
          )}

          {/* Collapsible Sources */}
          {hasSources && (
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                onClick={() => setSourcesExpanded((v) => !v)}
              >
                {sourcesExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                <span className="text-xs font-medium text-slate-600">Sources</span>
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ml-1 bg-slate-100 text-slate-600 border border-slate-200">
                  {answer.sources!.length}
                </span>
              </button>
              {sourcesExpanded && (
                <div className="px-3 pb-3 pt-2 flex flex-wrap gap-2">
                  {answer.sources!.map((source) => (
                    <span
                      key={source.id}
                      className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                      title={source.fileName ?? source.id}
                      onClick={() => onSourceClick(source)}
                    >
                      {source.toolName && (
                        <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-700">
                          {getToolDisplayName(source.toolName)}
                        </span>
                      )}
                      {source.fileName || source.id}
                      {source.relevance !== null && source.relevance !== undefined && (
                        <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${
                          source.relevance >= 0.7 ? 'bg-emerald-50 text-emerald-700'
                          : source.relevance >= 0.5 ? 'bg-amber-50 text-amber-700'
                          : 'bg-red-50 text-red-700'
                        }`}>
                          {Math.round(source.relevance * 100)}%
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Similar Questions */}
          {projectId && question?.id && question?.opportunityId && (
            <SimilarQuestionsPanel
              projectId={projectId}
              opportunityId={question.opportunityId}
              questionFileId={question.questionFileId}
              questionId={question.id}
              currentAnswer={answer?.text}
              isUnsaved={isUnsaved}
              onSelectQuestion={onSelectQuestion}
              onAnswerApplied={onAnswerApplied}
              onUseAnswer={onAnswerChange}
            />
          )}

          {/* Last edited / approved by */}
          {answer?.updatedByName && (
            <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
              <span>
                Last edited by <strong className="text-slate-500">{answer.updatedByName}</strong>
                {answer.updatedAt && (
                  <span className="ml-1">
                    · {new Date(answer.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </span>
              {answer.approvedByName && answer.status === 'APPROVED' && (
                <span>
                  · Approved by <strong className="text-emerald-600">{answer.approvedByName}</strong>
                  {answer.approvedAt && (
                    <span className="ml-1">
                      · {new Date(answer.approvedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Action area */}
          <div className="flex items-center justify-between pt-3 border-t">
            <div className="flex items-center gap-3">
              <PermissionButton
                requiredPermission="answer:generate"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={onGenerateAnswer}
                disabled={isGenerating || isLockedByOther}
              >
                {isGenerating ? (
                  <><Spinner className="h-4 w-4" />Generating...</>
                ) : (
                  <><Sparkles className="h-4 w-4" />Generate</>
                )}
              </PermissionButton>
              {selectedIndexes.size > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {selectedIndexes.size} {selectedIndexes.size === 1 ? 'index' : 'indexes'}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <PermissionDeleteButton
                requiredPermission="question:delete"
                variant="destructive"
                size="sm"
                onClick={onRemoveQuestion}
                showLabel
                label={isRemoving ? 'Removing...' : 'Remove'}
                isLoading={isRemoving}
              />
              {/* Show Unapprove only if: has text + text matches approved text (user hasn't changed it) */}
              {(() => {
                const currentText = answer?.text?.trim() ?? '';
                const approvedTextVal = answer?.approvedText?.trim() ?? '';
                const isTextMatchingApproved = currentText === approvedTextVal && approvedTextVal.length > 0;
                
                if (currentText && isTextMatchingApproved && onUnapprove) {
                  // Text matches what was approved — show Unapprove
                  return (
                    <PermissionButton
                      requiredPermission="answer:edit"
                      variant="outline"
                      size="sm"
                      onClick={onUnapprove}
                      disabled={isUnapproving || isRemoving || isLockedByOther}
                      className="border-slate-300 text-slate-600 hover:bg-slate-50"
                    >
                      {isUnapproving ? <><Spinner className="h-4 w-4 mr-1" />Reverting...</> : 'Unapprove'}
                    </PermissionButton>
                  );
                } else if (currentText) {
                  // Text exists but differs from approved (or never approved) — show Approve
                  return (
                    <PermissionButton
                      requiredPermission="answer:edit"
                      variant="default"
                      size="sm"
                      onClick={onApprove}
                      disabled={isApproving || isRemoving || isGenerating || isLockedByOther}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    >
                      {isApproving ? <><Spinner className="h-4 w-4 mr-1" />Approving...</> : <><Save className="h-4 w-4 mr-1" />Approve</>}
                    </PermissionButton>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Floating comments window */}
      {showComments && projectId && collaboration?.orgId && collaboration.currentUserId && (
        <FloatingPanel title="Comments" onClose={() => setShowComments(false)}>
          <CollaborationPanel
            projectId={projectId}
            orgId={collaboration.orgId}
            entityType={'QUESTION' as CommentEntityType}
            entityId={question.id}
            entityPk={collaboration.questionEntityPk ?? 'QUESTION'}
            entitySk={collaboration.questionEntitySk ?? question.id}
            currentUserId={collaboration.currentUserId}
            canComment={collaboration.canComment ?? false}
          />
        </FloatingPanel>
      )}
    </div>
  );
}
