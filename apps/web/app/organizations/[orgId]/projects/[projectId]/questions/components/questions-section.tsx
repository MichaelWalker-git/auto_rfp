'use client';

import React, { Suspense, useMemo } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

import { QuestionsProvider, useQuestions } from './questions-provider';
import { QuestionsHeader } from './questions-header';
import { NoRfpDocumentAvailable } from './no-rfp-document-available';
import { SourceDetailsDialog } from './source-details-dialog';
import { QuestionsFilterTabs } from './questions-filter-tabs';
import { QuestionsErrorState, QuestionsLoadingState } from './questions-states';
import { IndexSelector } from './index-selector';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface QuestionsSectionProps {
  orgId: string;
  projectId: string;
}

// ────────────────────────────────────────────
// Inner component (uses context)
// ────────────────────────────────────────────

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

  // ── Derived state ──────────────────────────

  const hasQuestions = useMemo(() => {
    if (!questions?.sections?.length) return false;
    return questions.sections.some((section) => (section?.questions?.length ?? 0) > 0);
  }, [questions]);

  const isSaving = savingQuestions.size > 0;

  // ── Early returns ──────────────────────────

  if (isLoading) return <QuestionsLoadingState />;
  if (error) return <QuestionsErrorState error={error} />;
  if (!hasQuestions) return <NoRfpDocumentAvailable projectId={projectId} />;

  // ── Render ─────────────────────────────────

  return (
    <div className="container mx-auto p-12 space-y-6">
      <QuestionsHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSaveAll={saveAllAnswers}
        onExport={handleExportAnswers}
        onReload={refreshQuestions}
        unsavedCount={unsavedQuestions.size}
        isSaving={isSaving}
        projectId={projectId}
      />

      <IndexSelector
        availableIndexes={availableIndexes}
        selectedIndexes={selectedIndexes}
        organizationConnected={organizationConnected}
        onIndexToggle={handleIndexToggle}
        onSelectAllIndexes={handleSelectAllIndexes}
      />

      <QuestionsFilterTabs rfpDocument={questions} orgId={orgId} />

      <SourceDetailsDialog
        isOpen={isSourceModalOpen}
        onClose={() => setIsSourceModalOpen(false)}
        source={selectedSource}
      />
    </div>
  );
}

// ────────────────────────────────────────────
// Public export with Suspense + Provider
// ────────────────────────────────────────────

export function QuestionsSection({ orgId, projectId }: QuestionsSectionProps) {
  return (
    <QuestionsProvider projectId={projectId}>
      <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
        <QuestionsSectionInner projectId={projectId} orgId={orgId} />
      </Suspense>
    </QuestionsProvider>
  );
}
