'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Save, Sparkles, Trash2, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { AnswerSource, ConfidenceBreakdown, ConfidenceBand, type CommentEntityType } from '@auto-rfp/core';
import PermissionWrapper from '@/components/permission-wrapper';
import { ConfidenceScoreDisplay } from '@/components/confidence/confidence-score-display';
import { SimilarQuestionsPanel } from './similar-questions-panel';
import { EditingIndicator, CollaborationPanel, FloatingPanel } from '@/features/collaboration';

interface AnswerData {
  text: string;
  sources?: AnswerSource[];
  confidence?: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: ConfidenceBand;
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

// Status badge derived from answer.status + presence
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DRAFT:    { label: 'Draft',    className: 'bg-slate-100 text-slate-600 border-slate-200' },
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

  const editors = collaboration?.editingUsers ?? [];
  const hasSources = answer?.sources && answer.sources.length > 0;
  const hasConfidence = answer?.confidence !== undefined && answer.confidence !== null;

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
                  className="gap-1 text-slate-500 h-7 px-2"
                  onClick={() => setShowComments((v) => !v)}
                  title={showComments ? 'Hide comments' : 'Show comments'}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="text-xs">Comments</span>
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

          {/* Textarea — amber ring + disabled when someone else is editing */}
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
                      className="inline-block px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                      title={source.fileName}
                      onClick={() => onSourceClick(source)}
                    >
                      {source.fileName}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Similar Questions */}
          {projectId && question?.id && (
            <SimilarQuestionsPanel
              projectId={projectId}
              questionId={question.id}
              currentAnswer={answer?.text}
              isUnsaved={isUnsaved}
              onSelectQuestion={onSelectQuestion}
              onAnswerApplied={onAnswerApplied}
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
            <PermissionWrapper requiredPermission={'answer:generate'}>
              <div className="flex items-center gap-3">
                <Button
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
                </Button>
                {selectedIndexes.size > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedIndexes.size} {selectedIndexes.size === 1 ? 'index' : 'indexes'}
                  </Badge>
                )}
              </div>
            </PermissionWrapper>

            <div className="flex items-center gap-2">
              <PermissionWrapper requiredPermission={'question:delete'}>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onRemoveQuestion}
                  disabled={isSaving || isGenerating || isRemoving || isLockedByOther}
                >
                  {isRemoving ? <><Spinner className="h-4 w-4 mr-1" />Removing...</> : <><Trash2 className="h-4 w-4 mr-1" />Remove</>}
                </Button>
              </PermissionWrapper>
              <PermissionWrapper requiredPermission={'answer:edit'}>
                {answer?.text && answer.status === 'APPROVED' && onUnapprove ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onUnapprove}
                    disabled={isUnapproving || isRemoving || isLockedByOther}
                    className="border-slate-300 text-slate-600 hover:bg-slate-50"
                    title="Revert approval"
                  >
                    {isUnapproving ? <><Spinner className="h-4 w-4 mr-1" />Reverting...</> : 'Unapprove'}
                  </Button>
                ) : answer?.text ? (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onApprove}
                    disabled={isApproving || isRemoving || isGenerating || isLockedByOther}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                  >
                    {isApproving ? <><Spinner className="h-4 w-4 mr-1" />Approving...</> : <><Save className="h-4 w-4 mr-1" />Approve</>}
                  </Button>
                ) : null}
              </PermissionWrapper>
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
