'use client';

import React, { useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Link } from 'lucide-react';
import type { ConfidenceBand } from '@auto-rfp/core';

import { useQuestions } from './questions-provider';
import { QuestionsTabsContent } from './questions-tabs-content';
import { ClustersView } from './clusters-view';
import { useClusters } from '@/lib/hooks/use-clustering';

interface QuestionsFilterTabsProps {
  rfpDocument: any;
  orgId: string;
  projectId: string;
  opportunityId?: string | null;
}

export function QuestionsFilterTabs({ rfpDocument, orgId, projectId, opportunityId }: QuestionsFilterTabsProps) {
  const {
    activeTab,
    setActiveTab,
    selectedQuestion,
    setSelectedQuestion,
    setShowAIPanel,

    getSelectedQuestionData,

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

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const questionData = getSelectedQuestionData();

  // Compute counts from rfpDocument prop (already filtered by opportunity)
  const counts = React.useMemo(() => {
    if (!rfpDocument?.sections?.length) return { all: 0, answered: 0, unanswered: 0 };
    
    const allQuestions = rfpDocument.sections.flatMap((s: any) => s.questions);
    const answeredCount = allQuestions.filter((q: any) => {
      const text = answers[q?.id]?.text;
      return typeof text === 'string' && text.trim().length > 0;
    }).length;
    
    return {
      all: allQuestions.length,
      answered: answeredCount,
      unanswered: allQuestions.length - answeredCount,
    };
  }, [rfpDocument, answers]);

  // Compute confidence counts from rfpDocument
  const confidenceCounts = React.useMemo(() => {
    if (!rfpDocument?.sections?.length) return { high: 0, medium: 0, low: 0 };
    
    const allQuestions = rfpDocument.sections.flatMap((s: any) => s.questions);
    let high = 0, medium = 0, low = 0;
    
    for (const q of allQuestions) {
      const answerData = answers[q.id];
      if (!answerData?.confidence) {
        if (answerData?.text) low++;
        continue;
      }
      // Normalize confidence (handle both 0-1 and 0-100 ranges)
      const rawConf = answerData.confidence;
      const pct = rawConf > 1 ? rawConf : Math.round(rawConf * 100);
      if (pct >= 90) high++;
      else if (pct >= 70) medium++;
      else low++;
    }
    
    return { high, medium, low };
  }, [rfpDocument, answers]);

  // Filter questions based on tab and search (using rfpDocument)
  const getFilteredQuestions = React.useCallback((filterType: string = 'all') => {
    if (!rfpDocument?.sections?.length) return [];
    
    const allQuestions = rfpDocument.sections.flatMap((section: any) =>
      section.questions.map((question: any) => ({
        ...question,
        sectionTitle: section.title,
        sectionId: section.id,
      })),
    );

    let statusFiltered = allQuestions;

    const hasAnswer = (q: any) => {
      const text = answers[q.id]?.text;
      return typeof text === 'string' && text.trim().length > 0;
    };

    if (filterType === 'answered') {
      statusFiltered = allQuestions.filter(hasAnswer);
    } else if (filterType === 'unanswered') {
      statusFiltered = allQuestions.filter((q: any) => !hasAnswer(q));
    }

    // Apply confidence band filter
    if (confidenceFilter !== 'all') {
      statusFiltered = statusFiltered.filter((q: any) => {
        const answerData = answers[q.id];
        if (!answerData?.text?.trim()) return false;
        if (answerData.confidence == null) return confidenceFilter === 'low';
        const rawConf = answerData.confidence;
        const pct = rawConf > 1 ? rawConf : Math.round(rawConf * 100);
        if (confidenceFilter === 'high') return pct >= 90;
        if (confidenceFilter === 'medium') return pct >= 70 && pct < 90;
        return pct < 70;
      });
    }

    // Apply search query
    let result = statusFiltered;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((q: any) => 
        q.question.toLowerCase().includes(query) || 
        q.sectionTitle.toLowerCase().includes(query)
      );
    }

    // Sort by confidence if enabled
    if (sortByConfidence) {
      result = [...result].sort((a: any, b: any) => {
        const confA = answers[a.id]?.confidence ?? 0;
        const confB = answers[b.id]?.confidence ?? 0;
        return confA - confB;
      });
    }

    return result;
  }, [rfpDocument, answers, confidenceFilter, searchQuery, sortByConfidence]);

  // Get cluster count for the badge - filtered by opportunityId
  const { data: clustersData } = useClusters(projectId, opportunityId);
  const clusterCount = clustersData?.clusters?.length ?? 0;

  // On mount: read ?questionId= from URL and auto-select that question
  useEffect(() => {
    const urlQuestionId = searchParams.get('questionId');
    if (urlQuestionId && urlQuestionId !== selectedQuestion) {
      setSelectedQuestion(urlQuestionId);
      setShowAIPanel(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // When selected question changes: update URL without full navigation
  const handleSelectQuestion = (id: string) => {
    setSelectedQuestion(id);
    setShowAIPanel(false);
    // Update ?questionId= in URL (replaceState — no history entry)
    const params = new URLSearchParams(searchParams.toString());
    params.set('questionId', id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const confidenceBands: { value: ConfidenceBand | 'all'; label: string; colorClass: string; count?: number }[] = [
    { value: 'all', label: 'All', colorClass: '', count: undefined },
    { value: 'high', label: 'High', colorClass: 'text-green-700', count: confidenceCounts.high },
    { value: 'medium', label: 'Medium', colorClass: 'text-yellow-700', count: confidenceCounts.medium },
    { value: 'low', label: 'Low', colorClass: 'text-red-700', count: confidenceCounts.low },
  ];

  return (
    <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid w-full grid-cols-4 mb-4">
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

        <TabsTrigger value="clusters" className="gap-1">
          <Link className="h-3.5 w-3.5" />
          Clusters
          {clusterCount > 0 && (
            <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-700">
              {clusterCount}
            </Badge>
          )}
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
            projectId={projectId}
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
            onSelectQuestion={handleSelectQuestion}
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

      <TabsContent value="clusters" className="space-y-4">
        <ClustersView
          projectId={projectId}
          onSelectQuestion={(id) => {
            setSelectedQuestion(id);
            setActiveTab('all'); // Switch to "All" tab to show the question editor
            setShowAIPanel(false);
          }}
          selectedQuestion={selectedQuestion}
          answers={answers}
          opportunityId={opportunityId}
        />
      </TabsContent>
    </Tabs>
  );
}