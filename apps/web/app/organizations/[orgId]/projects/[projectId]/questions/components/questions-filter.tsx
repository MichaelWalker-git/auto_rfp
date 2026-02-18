'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnswerSource, ConfidenceBreakdown, ConfidenceBand } from '@auto-rfp/core';
import { ConfidenceBadge } from '@/components/confidence/confidence-score-display';

interface AnswerData {
  text: string;
  sources?: AnswerSource[];
  confidence?: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: ConfidenceBand;
}

interface QuestionWithSection {
  id: string;
  question: string;
  sectionTitle: string;
  sectionId: string;
}

interface QuestionsFilterProps {
  questions: QuestionWithSection[];
  answers: Record<string, AnswerData>;
  unsavedQuestions: Set<string>;
  selectedQuestion: string | null;
  onSelectQuestion: (questionId: string) => void;
  filterType: string;
  title: string;
  emptyMessage: string;
}

export function QuestionsFilter({
  questions,
  answers,
  unsavedQuestions,
  selectedQuestion,
  onSelectQuestion,
  filterType,
  title,
  emptyMessage
}: QuestionsFilterProps) {
  const getStatusIcon = (questionId: string) => {
    const text = answers[questionId]?.text;
    const hasAnswer = typeof text === 'string' && text.trim() !== '';
    
    if (filterType === "answered" && hasAnswer) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    } else if (filterType === "unanswered" && !hasAnswer) {
      return <div className="h-4 w-4 rounded-full border border-muted-foreground" />;
    }
    
    return hasAnswer ? <CheckCircle className="h-4 w-4 text-green-500" /> : <div className="h-4 w-4 rounded-full border border-muted-foreground" />;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {questions.map((question) => (
            <button
              key={question.id}
              className={cn(
                "flex w-full text-left items-start p-2 rounded-md text-sm hover:bg-muted",
                unsavedQuestions.has(question.id) && "bg-amber-50",
                selectedQuestion === question.id && "bg-muted"
              )}
              onClick={() => onSelectQuestion(question.id)}
            >
              <div className="flex w-full">
                <div className="flex-shrink-0 w-5 h-5 mt-0.5 mr-2">
                  {getStatusIcon(question.id)}
                </div>
                <div className={cn(
                  "flex-1 mr-2",
                  unsavedQuestions.has(question.id) && "font-medium text-amber-700"
                )}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{question.sectionTitle}</div>
                    {answers[question.id]?.confidence != null && (
                      <ConfidenceBadge
                        confidence={answers[question.id].confidence}
                        band={answers[question.id].confidenceBand}
                      />
                    )}
                  </div>
                  {question.question}
                  {unsavedQuestions.has(question.id) && <span className="ml-1 text-amber-600">*</span>}
                </div>
              </div>
            </button>
          ))}
          {questions.length === 0 && (
            <p className="text-muted-foreground text-center p-4">{emptyMessage}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
} 