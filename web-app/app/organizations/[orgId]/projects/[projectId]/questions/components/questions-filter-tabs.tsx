'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpDown } from 'lucide-react';
import type { ConfidenceBand } from '@auto-rfp/shared';

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
    getConfidenceCounts,

    confidenceFilter,
    setConfidenceFilter,
    sortByConfidence,
    setSortByConfidence,

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
  const confidenceCounts = getConfidenceCounts();

  const confidenceBands: { value: ConfidenceBand | 'all'; label: string; colorClass: string; count?: number }[] = [
    { value: 'all', label: 'All', colorClass: '', count: undefined },
    { value: 'high', label: 'High', colorClass: 'text-green-700', count: confidenceCounts.high },
    { value: 'medium', label: 'Medium', colorClass: 'text-yellow-700', count: confidenceCounts.medium },
    { value: 'low', label: 'Low', colorClass: 'text-red-700', count: confidenceCounts.low },
  ];

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

      {/* Confidence Filter & Sort Controls — only shown on "answered" tab */}
      {activeTab === 'answered' && counts.answered > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Confidence:</span>
          {confidenceBands.map((band) => (
            <Button
              key={band.value}
              variant={confidenceFilter === band.value ? 'default' : 'outline'}
              size="sm"
              className={`h-7 text-xs gap-1 ${confidenceFilter !== band.value && band.colorClass ? band.colorClass : ''}`}
              onClick={() => setConfidenceFilter(band.value)}
            >
              {band.label}
              {band.count !== undefined && (
                <Badge variant="secondary" className="ml-0.5 h-4 text-[10px] px-1">
                  {band.count}
                </Badge>
              )}
            </Button>
          ))}
          <div className="ml-auto">
            <Button
              variant={sortByConfidence ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setSortByConfidence(!sortByConfidence)}
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortByConfidence ? 'Sorted by confidence' : 'Sort by confidence'}
            </Button>
          </div>
        </div>
      )}

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