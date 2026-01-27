'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

import { useQuestions } from './questions-provider';
import { QuestionsTabsContent } from './questions-tabs-content';

interface QuestionsFilterTabsProps {
  rfpDocument: any;
  orgId: string;
}

export function QuestionsFilterTabs({ rfpDocument, orgId }: QuestionsFilterTabsProps) {
  const {
    activeTab,
    setActiveTab,
    selectedQuestion,
    setSelectedQuestion,
    setShowAIPanel,

    getSelectedQuestionData,
    getFilteredQuestions,
    getCounts,

    answers,
    unsavedQuestions,
    selectedIndexes,
    isGenerating,
    savingQuestions,
    showAIPanel,
    searchQuery,

    handleAnswerChange,
    handleSaveAnswer,
    handleGenerateAnswer,
    handleSourceClick,

    removeQuestion,
    removingQuestions,
  } = useQuestions() as any;

  const questionData = getSelectedQuestionData();
  const counts = getCounts();

  return (
    <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid w-full grid-cols-3 mb-4">
        <TabsTrigger value="all" className="gap-1">
          All Questions
          <Badge variant="secondary" className="ml-1">
            {counts.all}
          </Badge>
        </TabsTrigger>

        <TabsTrigger value="answered" className="gap-1">
          Answered
          <Badge variant="secondary" className="ml-1">
            {counts.answered}
          </Badge>
        </TabsTrigger>

        <TabsTrigger value="unanswered" className="gap-1">
          Unanswered
          <Badge variant="secondary" className="ml-1">
            {counts.unanswered}
          </Badge>
        </TabsTrigger>
      </TabsList>

      {['all', 'answered', 'unanswered'].map((filterType) => (
        <TabsContent key={filterType} value={filterType} className="space-y-4">
          <QuestionsTabsContent
            orgId={orgId}
            questions={getFilteredQuestions(filterType)}
            selectedQuestion={selectedQuestion}
            questionData={questionData}
            answers={answers}
            unsavedQuestions={unsavedQuestions}
            selectedIndexes={selectedIndexes}
            isGenerating={isGenerating}
            savingQuestions={savingQuestions}
            showAIPanel={showAIPanel}
            filterType={filterType}
            onSelectQuestion={(id) => {
              setSelectedQuestion(id);
              setShowAIPanel(false);
            }}
            onAnswerChange={handleAnswerChange}
            onSave={handleSaveAnswer}
            onGenerateAnswer={handleGenerateAnswer}
            onSourceClick={handleSourceClick}
            onRemoveQuestion={removeQuestion}
            removingQuestions={removingQuestions}
            rfpDocument={rfpDocument}
            searchQuery={searchQuery}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}