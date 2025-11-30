"use client"

import React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { useQuestions } from "./questions-provider"
import { QuestionsTabsContent } from "./questions-tabs-content"

interface QuestionsFilterTabsProps {
  rfpDocument: any;
}

export function QuestionsFilterTabs({ rfpDocument }: QuestionsFilterTabsProps) {
  const {
    activeTab,
    setActiveTab,
    selectedQuestion,
    getSelectedQuestionData,
    answers,
    unsavedQuestions,
    selectedIndexes,
    isGenerating,
    isMultiStepGenerating,
    savingQuestions,
    useMultiStep,
    showAIPanel,
    setSelectedQuestion,
    setShowAIPanel,
    handleAnswerChange,
    saveAnswer,
    handleGenerateAnswer,
    handleSourceClick,
    setUseMultiStep,
    getFilteredQuestions,
    getCounts,
    searchQuery,
  } = useQuestions();

  const questionData = getSelectedQuestionData();
  const counts = getCounts();

  return (
    <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid w-full grid-cols-3 mb-4">
        <TabsTrigger value="all" className="gap-1">
          All Questions
          <Badge variant="secondary" className="ml-1">{counts.all}</Badge>
        </TabsTrigger>
        <TabsTrigger value="answered" className="gap-1">
          Answered
          <Badge variant="secondary" className="ml-1">{counts.answered}</Badge>
        </TabsTrigger>
        <TabsTrigger value="unanswered" className="gap-1">
          Unanswered
          <Badge variant="secondary" className="ml-1">{counts.unanswered}</Badge>
        </TabsTrigger>
      </TabsList>

      {["all", "answered", "unanswered"].map(filterType => (
        <TabsContent key={filterType} value={filterType} className="space-y-4">
          <QuestionsTabsContent
            questions={getFilteredQuestions(filterType)}
            selectedQuestion={selectedQuestion}
            questionData={questionData}
            answers={answers}
            unsavedQuestions={unsavedQuestions}
            selectedIndexes={selectedIndexes}
            isGenerating={isGenerating}
            isMultiStepGenerating={isMultiStepGenerating}
            savingQuestions={savingQuestions}
            useMultiStep={useMultiStep}
            showAIPanel={showAIPanel}
            filterType={filterType}
            onSelectQuestion={(id) => {
              setSelectedQuestion(id);
              setShowAIPanel(false);
            }}
            onAnswerChange={handleAnswerChange}
            onSave={saveAnswer}
            onGenerateAnswer={handleGenerateAnswer}
            onSourceClick={handleSourceClick}
            onMultiStepToggle={setUseMultiStep}
            rfpDocument={rfpDocument}
            searchQuery={searchQuery}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
} 