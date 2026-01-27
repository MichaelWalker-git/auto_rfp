'use client';

import React, { Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';

import { QuestionsProvider, useQuestions } from './questions-provider';
import { QuestionsHeader } from './questions-header';
import { NoRfpDocumentAvailable } from './no-rfp-document-available';
import { SourceDetailsDialog } from './source-details-dialog';
import { QuestionsFilterTabs } from './questions-filter-tabs';
import { QuestionsErrorState, QuestionsLoadingState } from './questions-states';
import { IndexSelector } from './index-selector';

interface QuestionsSectionProps {
  orgId: string;
  projectId: string;
}

function QuestionsSectionInner({ orgId, projectId }: QuestionsSectionProps) {

  const {
    isLoading,
    error,
    questions,
    unsavedQuestions,
    savingQuestions,
    searchQuery,
    setSearchQuery,
    selectedSource,
    isSourceModalOpen,
    setIsSourceModalOpen,
    saveAllAnswers,
    handleExportAnswers,
    selectedIndexes,
    availableIndexes,
    organizationConnected,
    handleIndexToggle,
    handleSelectAllIndexes,
    refreshQuestions,
  } = useQuestions();

  const handleUploadComplete = () => {
    // Refresh the questions data after successful upload
    refreshQuestions();
  };

  return (
    <div className="space-y-6 p-6 md:p-8 lg:p-12 min-h-screen">
      {/* Loading state */}
      {isLoading && <QuestionsLoadingState/>}

      {/* Error state */}
      {error && <QuestionsErrorState error={error}/>}

      {/* No questions state */}
      {(!isLoading && !error && (!questions || (questions?.sections?.length || 0) === 0 ||
        questions.sections.every(section => section?.questions?.length === 0))) && (
        <NoRfpDocumentAvailable projectId={projectId}/>
      )}

      {/* Questions available state */}
      {!isLoading && !error && questions && questions?.sections?.length > 0 &&
        !questions.sections.every(section => section?.questions?.length === 0) && (
          <>
            <QuestionsHeader
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSaveAll={saveAllAnswers}
              onExport={handleExportAnswers}
              onReload={refreshQuestions}
              unsavedCount={unsavedQuestions.size}
              isSaving={savingQuestions.size > 0}
              projectId={projectId}
            />

            {/* Index Selection Panel */}
            <IndexSelector
              availableIndexes={availableIndexes}
              selectedIndexes={selectedIndexes}
              organizationConnected={organizationConnected}
              onIndexToggle={handleIndexToggle}
              onSelectAllIndexes={handleSelectAllIndexes}
            />

            {/* Questions Filter Tabs */}
            <QuestionsFilterTabs rfpDocument={questions} orgId={orgId}/>
          </>
        )}

      {/* Source Details Dialog */}
      <SourceDetailsDialog
        isOpen={isSourceModalOpen}
        onClose={() => setIsSourceModalOpen(false)}
        source={selectedSource}
      />

      <Toaster/>
    </div>
  );
}

export function QuestionsSection({ orgId, projectId }: QuestionsSectionProps) {
  return (
    <QuestionsProvider projectId={projectId}>
      <Suspense fallback={
        <div className="space-y-6 p-6 md:p-8 lg:p-12 min-h-screen">
          <div className="flex items-center justify-between">
            <div className="h-8 w-36 bg-muted animate-pulse rounded"></div>
            <div className="flex items-center gap-2">
              <div className="h-9 w-64 bg-muted animate-pulse rounded"></div>
              <div className="h-9 w-24 bg-muted animate-pulse rounded"></div>
              <div className="h-9 w-32 bg-muted animate-pulse rounded"></div>
            </div>
          </div>
          <div className="h-12 bg-muted animate-pulse rounded"></div>
          <div className="h-[500px] bg-muted animate-pulse rounded"></div>
        </div>
      }>
        <QuestionsSectionInner projectId={projectId} orgId={orgId}/>
      </Suspense>
    </QuestionsProvider>
  );
} 