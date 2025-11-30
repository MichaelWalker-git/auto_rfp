"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { QuestionsFilter } from "./questions-filter"
import { QuestionEditor } from "./question-editor"
import { QuestionNavigator } from "../../../components/question-navigator"
import { AISuggestionsPanel } from "../../../components/ai-suggestions-panel"
import { AnswerSource } from "@/types/api"

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
  questions: QuestionWithSection[];
  selectedQuestion: string | null;
  questionData: { question: any; section: any } | null;
  answers: Record<string, AnswerData>;
  unsavedQuestions: Set<string>;
  selectedIndexes: Set<string>;
  isGenerating: Record<string, boolean>;
  isMultiStepGenerating: boolean;
  savingQuestions: Set<string>;
  useMultiStep: boolean;
  showAIPanel: boolean;
  filterType: string;
  onSelectQuestion: (questionId: string) => void;
  onAnswerChange: (questionId: string, value: string) => void;
  onSave: (questionId: string) => void;
  onGenerateAnswer: (questionId: string) => void;
  onSourceClick: (source: AnswerSource) => void;
  onMultiStepToggle: (enabled: boolean) => void;
  rfpDocument?: any;
  searchQuery?: string;
}

export function QuestionsTabsContent({
  questions,
  selectedQuestion,
  questionData,
  answers,
  unsavedQuestions,
  selectedIndexes,
  isGenerating,
  isMultiStepGenerating,
  savingQuestions,
  useMultiStep,
  showAIPanel,
  filterType,
  onSelectQuestion,
  onAnswerChange,
  onSave,
  onGenerateAnswer,
  onSourceClick,
  onMultiStepToggle,
  rfpDocument,
  searchQuery
}: QuestionsTabsContentProps) {
  const getFilterTitle = () => {
    switch (filterType) {
      case "answered": return "Answered Questions";
      case "unanswered": return "Unanswered Questions";
      default: return "Question Navigator";
    }
  };

  const getEmptyMessage = () => {
    switch (filterType) {
      case "answered": return "No answered questions found";
      case "unanswered": return "No unanswered questions found";
      default: return "No questions found";
    }
  };

  const getQuestionStatus = (questionId: string) => {
    const hasAnswer = answers[questionId]?.text && answers[questionId].text.trim() !== '';
    
    switch (filterType) {
      case "answered": return hasAnswer ? "Answered" : "Needs Answer";
      case "unanswered": return "Needs Answer";
      default: return hasAnswer ? "Answered" : "Needs Answer";
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-1">
        {filterType === "all" && rfpDocument ? (
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
              />
            </CardContent>
          </Card>
        ) : (
          <QuestionsFilter
            questions={questions}
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
      
      <div className="md:col-span-2">
        {selectedQuestion && questionData ? (
          <div className="space-y-4">
            <QuestionEditor
              question={questionData.question}
              section={questionData.section}
              answer={answers[selectedQuestion]}
              selectedIndexes={selectedIndexes}
              isUnsaved={unsavedQuestions.has(selectedQuestion)}
              isSaving={savingQuestions.has(selectedQuestion)}
              isGenerating={isGenerating[selectedQuestion] || isMultiStepGenerating}
              useMultiStep={useMultiStep}
              onAnswerChange={(value) => onAnswerChange(selectedQuestion, value)}
              onSave={() => onSave(selectedQuestion)}
              onGenerateAnswer={() => onGenerateAnswer(selectedQuestion)}
              onSourceClick={onSourceClick}
              onMultiStepToggle={onMultiStepToggle}
            />

            {showAIPanel && <AISuggestionsPanel questionId={selectedQuestion} />}
          </div>
        ) : (
          <Card className="flex h-[400px] items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground">
                Select a question from the {filterType === "all" ? "navigator" : "list"} to view and {filterType === "answered" ? "edit" : "answer"}
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
} 