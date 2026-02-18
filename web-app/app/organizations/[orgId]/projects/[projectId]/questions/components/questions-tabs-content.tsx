'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QuestionsFilter } from './questions-filter';
import { QuestionEditor } from './question-editor';
import { QuestionNavigator } from '../../../components/question-navigator';
import { AISuggestionsPanel } from '../../../components/ai-suggestions-panel';
import { AnswerSource } from '@auto-rfp/shared';
import { useQuestions } from './questions-provider';

interface AnswerData {
  text: string;
  sources?: AnswerSource[];
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
  const { confidenceFilter, handleBatchAnswerApplied } = useQuestions();

  // Build a set of visible question IDs from the filtered questions list
  const visibleQuestionIds = confidenceFilter !== 'all'
    ? new Set(filteredQuestions.map((q: any) => q.id))
    : null;

  const getFilterTitle = () => {
    switch (filterType) {
      case 'answered':
        return 'Answered Questions';
      case 'unanswered':
        return 'Unanswered Questions';
      default:
        return 'Question Navigator';
    }
  };

  const getEmptyMessage = () => {
    switch (filterType) {
      case 'answered':
        return 'No answered questions found';
      case 'unanswered':
        return 'No unanswered questions found';
      default:
        return 'No questions found';
    }
  };

  // kept (even if not used directly) to preserve your logic for future
  const getQuestionStatus = (questionId: string) => {
    const hasAnswer = !!answers[questionId]?.text?.trim();

    switch (filterType) {
      case 'answered':
        return hasAnswer ? 'Answered' : 'Needs Answer';
      case 'unanswered':
        return 'Needs Answer';
      default:
        return hasAnswer ? 'Answered' : 'Needs Answer';
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-3" style={{ minHeight: 'calc(100vh - 280px)' }}>
      <div className="md:col-span-1 max-h-[calc(100vh-280px)] overflow-y-auto">
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
                onSelectQuestion={(id) => onSelectQuestion(id)}
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

      <div className="md:col-span-2 md:sticky md:top-4 md:self-start max-h-[calc(100vh-280px)] overflow-y-auto">
        {selectedQuestion && questionData ? (
          <div className="space-y-4">
            <QuestionEditor
              question={questionData.question}
              section={questionData.section}
              answer={answers[selectedQuestion]}
              selectedIndexes={selectedIndexes}
              isUnsaved={unsavedQuestions.has(selectedQuestion)}
              isSaving={savingQuestions.has(selectedQuestion)}
              isGenerating={isGenerating[selectedQuestion]}
              onAnswerChange={(value) => onAnswerChange(selectedQuestion, value)}
              onSave={() => onSave(selectedQuestion)}
              onGenerateAnswer={() => onGenerateAnswer(orgId, selectedQuestion)}
              onSourceClick={onSourceClick}
              onRemoveQuestion={() => onRemoveQuestion(selectedQuestion)}
              isRemoving={removingQuestions?.has(selectedQuestion) ?? false}
              projectId={projectId}
              onSelectQuestion={onSelectQuestion}
              onAnswerApplied={handleBatchAnswerApplied}
            />

            {showAIPanel && <AISuggestionsPanel questionId={selectedQuestion}/>}
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