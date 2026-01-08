'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RfpSection } from '@/types/api';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AnswerSource } from '@auto-rfp/shared';

type AnswerData = {
  text: string;
  sources?: AnswerSource[];
}

type QuestionStatus = 'unanswered' | 'complete';

type Props = {
  onSelectQuestion: (id: string) => void;
  sections: RfpSection[];
  answers: Record<string, AnswerData>;
  unsavedQuestions?: Set<string>;
  searchQuery?: string;
}

export function QuestionNavigator({
                                    onSelectQuestion,
                                    sections,
                                    answers,
                                    unsavedQuestions = new Set(),
                                    searchQuery = ''
                                  }: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState<string>();

  useEffect(() => {
    if (sections.length > 0) {
      const initialState: Record<string, boolean> = {};
      sections.forEach((section, index) => {
        // Expand the first two sections by default
        initialState[section.id] = index < 10;
      });
      setExpandedSections(initialState);
    }
  }, [sections]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const getQuestionStatus = (questionId: string): QuestionStatus => {
    const answer = answers[questionId];

    if (!answer || !answer.text || answer.text.trim() === '') {
      return 'unanswered';
    }

    return 'complete';
  };

  const filteredSections = sections.map(section => {
    if (!searchQuery) return section;
    const filteredQuestions = section.questions.filter(question =>
      question.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return {
      ...section,
      questions: filteredQuestions
    };
  }).filter(section => section.questions.length > 0);

  const getTruncatedText = (text: string, maxLength: number = 70) => {
    if (!text) return text;
    if (text.length <= maxLength) return text;

    const breakPoint = text.substring(0, maxLength).lastIndexOf(' ');
    if (breakPoint > maxLength * 0.7) { // Only use breakpoint if it's not too short
      return text.substring(0, breakPoint) + '...';
    }

    return text.substring(0, maxLength) + '...';
  };

  return (
    <TooltipProvider>
      <div className="space-y-2 text-sm">
        {filteredSections.map((section) => (
          <div key={section.id} className="space-y-1">
            <button
              className="flex w-full items-center justify-between rounded-md p-2 font-medium hover:bg-muted"
              onClick={() => toggleSection(section.id)}
            >
              <span className="text-left pr-2 flex-1">{getTruncatedText(section.title, 85)}</span>
              {expandedSections[section.id] ? <ChevronDown className="h-4 w-4 flex-shrink-0"/> :
                <ChevronRight className="h-4 w-4 flex-shrink-0"/>}
            </button>
            {expandedSections[section.id] && (
              <div className="ml-2 space-y-1 pl-2">
                {section.questions.map((question) => {
                  const status = getQuestionStatus(question.id);
                  const isUnsaved = unsavedQuestions.has(question.id);

                  return (
                    <button
                      key={question.id}
                      className={cn(
                        'flex w-full text-left items-start p-2 rounded-md text-sm hover:bg-muted',
                        question.id == current && 'border-2'
                      )}
                      onClick={() => {
                        setCurrent(question.id);
                        onSelectQuestion(question.id);
                      }}
                    >
                      <div className="flex w-full">
                        <div className="flex-shrink-0 w-5 h-5 mt-0.5 mr-2">
                          {status === 'complete' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <CheckCircle className="h-4 w-4 text-green-500"/>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Question answered</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {status === 'unanswered' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="h-4 w-4 rounded-full border border-muted-foreground"/>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Question not yet answered</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div className={cn(
                          'flex-1 mr-2',
                          status === 'complete' && 'text-muted-foreground',
                          isUnsaved && 'font-medium text-amber-700'
                        )}>
                          {getTruncatedText(question.question)}
                          {isUnsaved && <span className="ml-1 text-amber-600">*</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
