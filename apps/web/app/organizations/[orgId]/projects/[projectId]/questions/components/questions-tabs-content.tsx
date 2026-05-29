'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { QuestionsFilter } from './questions-filter';
import { QuestionEditor } from './question-editor';
import { QuestionNavigator } from '../../../components/question-navigator';
import { AISuggestionsPanel } from '../../../components/ai-suggestions-panel';
import { AnswerSource } from '@auto-rfp/core';
import { useQuestions } from './questions-provider';
import { useAuth } from '@/components/AuthProvider';
import { usePresence } from '@/features/collaboration';

interface AnswerData {
  text: string;
  sources?: AnswerSource[];
  status?: string;
  updatedByName?: string;
  updatedAt?: string;
  approvedByName?: string;
  approvedAt?: string;
}

interface QuestionWithSection {
  id: string;
  question: string;
  sectionTitle: string;
  sectionId: string;
}

interface QuestionsTabsContentProps {
  orgId: string;
  projectId: string;
  questions: QuestionWithSection[];
  selectedQuestion: string | null;
  questionData: { question: any; section: any } | null;
  answers: Record<string, AnswerData>;
  unsavedQuestions: Set<string>;
  selectedIndexes: Set<string>;
  isGenerating: Record<string, boolean>;
  savingQuestions: Set<string>;
  showAIPanel: boolean;
  filterType: string;
  onSelectQuestion: (questionId: string) => void;
  onAnswerChange: (questionId: string, value: string) => void;
  onSave: (questionId: string) => void;
  onGenerateAnswer: (orgId: string, questionId: string) => void;
  onSourceClick: (source: AnswerSource) => void;
  onRemoveQuestion: (questionId: string) => void;
  removingQuestions?: Set<string>;
  rfpDocument?: any;
  searchQuery?: string;
}

export function QuestionsTabsContent({
  questions: filteredQuestions,
  selectedQuestion,
  questionData,
  answers,
  unsavedQuestions,
  selectedIndexes,
  isGenerating,
  savingQuestions,
  showAIPanel,
  filterType,
  onSelectQuestion,
  onAnswerChange,
  onSave,
  onGenerateAnswer,
  onSourceClick,
  onRemoveQuestion,
  removingQuestions,
  orgId,
  projectId,
  rfpDocument,
  searchQuery,
}: QuestionsTabsContentProps) {
  const {
    confidenceFilter,
    handleBatchAnswerApplied,
    handleApproveAnswer,
    approvingQuestions,
    handleUnapproveAnswer,
    unapprovingQuestions,
  } = useQuestions();
  const { userSub, permissions } = useAuth();
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(288);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(288);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - dragStartX.current;
      const newWidth = Math.min(480, Math.max(160, dragStartWidth.current + delta));
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth]);

  // Real-time presence + live answer sync
  const { getUsersOnQuestion, getQuestionLock, sendAnswerDelta, sendAnswerStatus, liveAnswers, liveAnswerMap, answerStatusMap, lockEditing, unlockEditing, updatePresence } = usePresence(projectId, orgId);

  // Track which question the current user is editing so we can unlock on switch
  const editingQuestionRef = useRef<string | null>(null);

  // Signal editing lock/unlock when user starts/stops typing or switches questions
  const handleAnswerChangeWithPresence = useCallback(
    (questionId: string, value: string) => {
      // If user starts editing a different question, unlock the previous one
      if (editingQuestionRef.current && editingQuestionRef.current !== questionId) {
        unlockEditing(editingQuestionRef.current);
      }
      editingQuestionRef.current = questionId;
      lockEditing(questionId);
      onAnswerChange(questionId, value);
      sendAnswerDelta(questionId, value);
    },
    [lockEditing, unlockEditing, onAnswerChange, sendAnswerDelta],
  );

  // Unlock editing when switching away from a question or unmounting
  useEffect(() => {
    return () => {
      if (editingQuestionRef.current) {
        unlockEditing(editingQuestionRef.current);
        editingQuestionRef.current = null;
      }
    };
  }, [unlockEditing]);

  // When selected question changes, unlock the previous one
  const prevSelectedQuestion = useRef<string | null>(null);
  useEffect(() => {
    if (prevSelectedQuestion.current && prevSelectedQuestion.current !== selectedQuestion) {
      if (editingQuestionRef.current === prevSelectedQuestion.current) {
        unlockEditing(prevSelectedQuestion.current);
        editingQuestionRef.current = null;
      }
    }
    prevSelectedQuestion.current = selectedQuestion;
    // Signal presence: viewing the selected question
    if (selectedQuestion) {
      updatePresence(selectedQuestion, 'viewing');
    }
  }, [selectedQuestion, unlockEditing, updatePresence]);

  // Apply incoming live answer deltas directly to the answer state
  // so the textarea updates in real time for all collaborators
  const prevLiveAnswers = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    liveAnswers.forEach((text, questionId) => {
      const prev = prevLiveAnswers.current.get(questionId);
      if (prev !== text) {
        prevLiveAnswers.current.set(questionId, text);
        // Only apply if it's from someone else (not our own echo)
        const entry = liveAnswerMap.get(questionId);
        if (entry && entry.userId !== userSub) {
          onAnswerChange(questionId, text);
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAnswers]);

  // Apply received answer status updates from collaborators to local answers
  const prevStatusMap = useRef<Map<string, unknown>>(new Map());
  useEffect(() => {
    answerStatusMap.forEach((statusData, questionId) => {
      const prev = prevStatusMap.current.get(questionId);
      if (prev !== statusData) {
        prevStatusMap.current.set(questionId, statusData);
        // Update the local answer state with the received metadata
        onAnswerChange(questionId, answers[questionId]?.text ?? '');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerStatusMap]);

  // Wrap approve/unapprove/save to also broadcast status via WebSocket
  const handleApproveWithBroadcast = useCallback(
    async (questionId: string) => {
      await handleApproveAnswer(questionId);
      // After approve, broadcast the updated status to collaborators
      const a = answers[questionId];
      sendAnswerStatus(questionId, {
        status: 'APPROVED',
        updatedByName: a?.updatedByName,
        updatedAt: new Date().toISOString(),
        approvedByName: a?.approvedByName,
        approvedAt: a?.approvedAt ?? new Date().toISOString(),
      });
    },
    [handleApproveAnswer, answers, sendAnswerStatus],
  );

  const handleUnapproveWithBroadcast = useCallback(
    async (questionId: string) => {
      await handleUnapproveAnswer(questionId);
      const a = answers[questionId];
      sendAnswerStatus(questionId, {
        status: 'DRAFT',
        updatedByName: a?.updatedByName,
        updatedAt: new Date().toISOString(),
        approvedByName: undefined,
        approvedAt: undefined,
      });
    },
    [handleUnapproveAnswer, answers, sendAnswerStatus],
  );

  const handleSaveWithBroadcast = useCallback(
    (questionId: string) => {
      onSave(questionId);
      const a = answers[questionId];
      sendAnswerStatus(questionId, {
        status: a?.status ?? 'DRAFT',
        updatedByName: a?.updatedByName,
        updatedAt: new Date().toISOString(),
      });
    },
    [onSave, answers, sendAnswerStatus],
  );

  const canComment = permissions.includes('collaboration:comment');

  const visibleQuestionIds = confidenceFilter !== 'all'
    ? new Set(filteredQuestions.map((q: any) => q.id))
    : null;

  const getFilterTitle = () => {
    switch (filterType) {
      case 'answered': return 'Answered Questions';
      case 'unanswered': return 'Unanswered Questions';
      default: return 'Question Navigator';
    }
  };

  const getEmptyMessage = () => {
    switch (filterType) {
      case 'answered': return 'No answered questions found';
      case 'unanswered': return 'No unanswered questions found';
      default: return 'No questions found';
    }
  };

  return (
    <div className="flex" style={{ minHeight: 'calc(100vh - 280px)', gap: 0 }}>
      {/* ── Left panel ── */}
      <div
        className="shrink-0 max-h-[calc(100vh-280px)] overflow-hidden flex flex-col"
        style={{ width: panelCollapsed ? 0 : panelWidth }}
      >
        {!panelCollapsed && (
          <div className="h-full overflow-y-auto" style={{ paddingRight: 8 }}>
            {filterType === 'all' && rfpDocument ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Question Navigator</CardTitle>
                </CardHeader>
                <CardContent>
                  <QuestionNavigator
                    sections={rfpDocument.sections}
                    answers={answers}
                    unsavedQuestions={unsavedQuestions}
                    onSelectQuestion={onSelectQuestion}
                    searchQuery={searchQuery}
                    visibleQuestionIds={visibleQuestionIds}
                    selectedQuestionId={selectedQuestion}
                  />
                </CardContent>
              </Card>
            ) : (
              <QuestionsFilter
                questions={filteredQuestions}
                answers={answers}
                unsavedQuestions={unsavedQuestions}
                selectedQuestion={selectedQuestion}
                onSelectQuestion={onSelectQuestion}
                filterType={filterType}
                title={getFilterTitle()}
                emptyMessage={getEmptyMessage()}
              />
            )}
          </div>
        )}

        {panelCollapsed && (
          <div className="flex flex-col items-center pt-10 gap-1">
            <span
              className="text-xs text-slate-400 font-medium"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              {getFilterTitle()}
            </span>
          </div>
        )}
      </div>

      {/* ── Divider with collapse toggle ── */}
      <div className="flex flex-col items-center shrink-0 mx-1 self-stretch gap-1 pt-2">
        {/* Collapse/expand button — clean pill button */}
        <button
          type="button"
          onClick={() => setPanelCollapsed((v) => !v)}
          className="flex items-center justify-center h-6 w-6 rounded-full bg-slate-100 hover:bg-indigo-100 hover:text-indigo-600 text-slate-400 transition-colors border border-slate-200 hover:border-indigo-300 shrink-0"
          title={panelCollapsed ? 'Expand navigator' : 'Collapse navigator'}
        >
          {panelCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>

        {/* Drag handle — only shown when panel is open */}
        {!panelCollapsed && (
          <div
            className="flex-1 w-1 cursor-col-resize hover:bg-indigo-400 bg-slate-200 transition-colors rounded-full"
            onMouseDown={handleDragStart}
            title="Drag to resize"
          />
        )}
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 min-w-0 md:sticky md:top-4 md:self-start max-h-[calc(100vh-280px)] overflow-y-auto">
        {selectedQuestion && questionData ? (
          <div className="space-y-4">
            <QuestionEditor
              question={questionData.question}
              section={questionData.section}
              answer={{
                ...answers[selectedQuestion],
                // Overlay live updatedByName from WebSocket delta
                ...(liveAnswerMap.get(selectedQuestion)?.displayName
                  ? {
                      updatedByName: liveAnswerMap.get(selectedQuestion)!.displayName,
                      updatedAt: new Date().toISOString(),
                    }
                  : {}),
                // Overlay live answer status (approved/draft/edited by) from WebSocket
                ...(answerStatusMap.get(selectedQuestion) ?? {}),
              }}
              selectedIndexes={selectedIndexes}
              isUnsaved={unsavedQuestions.has(selectedQuestion)}
              isSaving={savingQuestions.has(selectedQuestion)}
              isGenerating={isGenerating[selectedQuestion]}
              onAnswerChange={(value) => {
                handleAnswerChangeWithPresence(selectedQuestion, value);
              }}
              onSave={() => handleSaveWithBroadcast(selectedQuestion)}
              onApprove={() => handleApproveWithBroadcast(selectedQuestion)}
              isApproving={approvingQuestions.has(selectedQuestion)}
              onUnapprove={() => handleUnapproveWithBroadcast(selectedQuestion)}
              isUnapproving={unapprovingQuestions.has(selectedQuestion)}
              onGenerateAnswer={() => onGenerateAnswer(orgId, selectedQuestion)}
              onSourceClick={onSourceClick}
              onRemoveQuestion={() => onRemoveQuestion(selectedQuestion)}
              isRemoving={removingQuestions?.has(selectedQuestion) ?? false}
              projectId={projectId}
              onSelectQuestion={onSelectQuestion}
              onAnswerApplied={handleBatchAnswerApplied}
              liveAnswerText={liveAnswers.get(selectedQuestion)}
              collaboration={{
                orgId,
                currentUserId: userSub ?? undefined,
                editingUsers: (() => {
                  // Combine editing users from presence (status === 'editing') 
                  // AND from explicit EDITING_LOCK messages
                  const presenceEditors = getUsersOnQuestion(selectedQuestion).filter(
                    (u) => u.userId !== userSub && u.status === 'editing',
                  );
                  const lockInfo = getQuestionLock(selectedQuestion);
                  if (lockInfo && lockInfo.userId !== userSub) {
                    // If the lock user isn't already in presenceEditors, add a synthetic entry
                    const alreadyTracked = presenceEditors.some((u) => u.userId === lockInfo.userId);
                    if (!alreadyTracked) {
                      presenceEditors.push({
                        connectionId: '',
                        projectId,
                        orgId,
                        userId: lockInfo.userId,
                        displayName: lockInfo.displayName,
                        questionId: selectedQuestion,
                        status: 'editing',
                        connectedAt: new Date().toISOString(),
                        lastHeartbeatAt: new Date().toISOString(),
                        ttl: 0,
                      });
                    }
                  }
                  return presenceEditors;
                })(),
                canComment,
              }}
            />
            {showAIPanel && <AISuggestionsPanel questionId={selectedQuestion} />}
          </div>
        ) : (
          <Card className="flex h-full min-h-[400px] items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground">
                Select a question from the{' '}
                {filterType === 'all' ? 'navigator' : 'list'} to view and{' '}
                {filterType === 'answered' ? 'edit' : 'answer'}
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
