'use client';

import React, { Suspense, useMemo, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { FileText } from 'lucide-react';

import { QuestionsProvider, useQuestions } from './questions-provider';
import { QuestionsHeader } from './questions-header';
import { NoRfpDocumentAvailable } from './no-rfp-document-available';
import { SourceDetailsDialog } from './source-details-dialog';
import { QuestionsFilterTabs } from './questions-filter-tabs';
import { QuestionsErrorState, QuestionsLoadingState } from './questions-states';
import { IndexSelector } from './index-selector';
import { OpportunitySelector, OTHER_LEGACY_OPPORTUNITY_ID } from '@/components/brief/components/OpportunitySelector';
import { getSelectedOpportunity, saveSelectedOpportunity } from '@/lib/utils/opportunity-selection';
import type { OpportunityItem } from '@auto-rfp/core';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface QuestionsSectionProps {
  orgId: string;
  projectId: string;
  initialOpportunityId?: string;
  /** Hide the opportunity selector when opportunity is determined by URL path (e.g., /opportunities/[oppId]/questions) */
  hideOpportunitySelector?: boolean;
}

// ────────────────────────────────────────────
// Inner component (uses context)
// ────────────────────────────────────────────

interface QuestionsSectionInnerProps {
  orgId: string;
  projectId: string;
  selectedOpportunityId: string | null;
  selectedOpportunity: OpportunityItem | null;
  onOpportunitySelect: (oppId: string | null, opp: OpportunityItem | null) => void;
  hideOpportunitySelector?: boolean;
}

function QuestionsSectionInner({ 
  orgId, 
  projectId, 
  selectedOpportunityId, 
  selectedOpportunity,
  onOpportunitySelect,
  hideOpportunitySelector = false,
}: QuestionsSectionInnerProps) {
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
    getCounts,
  } = useQuestions();

  // ── Derived state ──────────────────────────

  // Filter questions by selected opportunity
  const filteredQuestions = useMemo(() => {
    if (!questions?.sections?.length) return null;
    
    // If no opportunity selected, show message to select one
    if (!selectedOpportunityId) return null;
    
    // Check if "Other / Legacy" option is selected
    const isOtherSelected = selectedOpportunityId === OTHER_LEGACY_OPPORTUNITY_ID;
    
    // Filter sections to only include questions that belong to the selected opportunity
    const filteredSections = questions.sections.map((section) => ({
      ...section,
      questions: section.questions.filter((q) => {
        const questionWithOpp = q as typeof q & { opportunityId?: string | null };
        const qOppId = questionWithOpp.opportunityId;
        
        if (isOtherSelected) {
          // For "Other / Legacy" - show questions without opportunityId (null, undefined, or empty string)
          return !qOppId || qOppId === null || qOppId === '';
        }
        
        // For normal opportunities - only show questions that match
        return qOppId === selectedOpportunityId;
      }),
    })).filter((section) => section.questions.length > 0);

    return { sections: filteredSections };
  }, [questions, selectedOpportunityId]);

  // Get counts from filtered questions (not from context)
  const filteredCounts = useMemo(() => {
    if (!filteredQuestions?.sections?.length) return { all: 0, answered: 0, unanswered: 0 };
    const allQuestions = filteredQuestions.sections.flatMap((s) => s.questions);
    return { all: allQuestions.length, answered: 0, unanswered: allQuestions.length };
  }, [filteredQuestions]);

  const hasQuestions = filteredCounts.all > 0;
  const isSaving = savingQuestions.size > 0;

  // ── Opportunity Selector (only shown when not hidden) ──
  const opportunitySelectorEl = hideOpportunitySelector ? null : (
    <div className="flex items-center gap-3 mb-6">
      <Label className="text-sm font-medium whitespace-nowrap">Opportunity:</Label>
      <div className="flex-1 max-w-md">
        <OpportunitySelector
          projectId={projectId}
          orgId={orgId}
          selectedOpportunityId={selectedOpportunityId}
          onSelect={onOpportunitySelect}
          showOtherOption
        />
      </div>
      {selectedOpportunity && selectedOpportunity.solicitationNumber && (
        <div className="text-sm text-muted-foreground truncate max-w-xs">
          <span className="font-medium">{selectedOpportunity.solicitationNumber}</span>
        </div>
      )}
    </div>
  );

  // ── Early returns ──────────────────────────

  if (error) {
    return (
      <div className="container mx-auto p-12 space-y-6">
        {opportunitySelectorEl}
        <QuestionsErrorState error={error} />
      </div>
    );
  }
  
  // Show opportunity selector with loading indicator or message
  if (!selectedOpportunityId) {
    return (
      <div className="container mx-auto p-12 space-y-6">
        {opportunitySelectorEl}
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4"/>
            <p className="text-sm text-muted-foreground">
              Select an opportunity above to view and manage questions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  // Show loading state but keep selector visible
  if (isLoading) {
    return (
      <div className="container mx-auto p-12 space-y-6">
        {opportunitySelectorEl}
        <QuestionsLoadingState />
      </div>
    );
  }
  
  // Show opportunity selector + empty state when no questions for selected opportunity
  if (!hasQuestions) {
    return (
      <div className="container mx-auto p-12 space-y-6">
        {opportunitySelectorEl}
        <NoRfpDocumentAvailable projectId={projectId} />
      </div>
    );
  }

  // ── Render ─────────────────────────────────

  return (
    <div className="container mx-auto p-12 space-y-6">
      {opportunitySelectorEl}

      <QuestionsHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSaveAll={saveAllAnswers}
        onExport={handleExportAnswers}
        onReload={refreshQuestions}
        unsavedCount={unsavedQuestions.size}
        isSaving={isSaving}
        projectId={projectId}
        orgId={orgId}
      />

      <IndexSelector
        availableIndexes={availableIndexes}
        selectedIndexes={selectedIndexes}
        organizationConnected={organizationConnected}
        onIndexToggle={handleIndexToggle}
        onSelectAllIndexes={handleSelectAllIndexes}
      />

      <QuestionsFilterTabs rfpDocument={filteredQuestions} orgId={orgId} projectId={projectId} opportunityId={selectedOpportunityId}/>

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

export function QuestionsSection({ orgId, projectId, initialOpportunityId, hideOpportunitySelector = false }: QuestionsSectionProps) {
  const router = useRouter();
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(
    initialOpportunityId ?? null
  );
  const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityItem | null>(null);

  // On mount, check sessionStorage for a previously saved selection
  useEffect(() => {
    if (!initialOpportunityId) {
      const savedOppId = getSelectedOpportunity(projectId);
      if (savedOppId) {
        setSelectedOpportunityId(savedOppId);
      }
    }
  }, [projectId, initialOpportunityId]);

  const handleOpportunitySelect = useCallback((oppId: string | null, opp: OpportunityItem | null) => {
    setSelectedOpportunityId(oppId);
    setSelectedOpportunity(opp);
    
    // Save to sessionStorage
    if (oppId) {
      saveSelectedOpportunity(projectId, oppId);
    }
    
    // Update URL query param
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (oppId) {
        url.searchParams.set('oppId', oppId);
      } else {
        url.searchParams.delete('oppId');
      }
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [projectId, router]);

  // Don't use key - let provider cache the data and filter in-memory
  return (
    <QuestionsProvider projectId={projectId} opportunityId={selectedOpportunityId}>
      <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
        <QuestionsSectionInner 
          projectId={projectId} 
          orgId={orgId}
          selectedOpportunityId={selectedOpportunityId}
          selectedOpportunity={selectedOpportunity}
          onOpportunitySelect={handleOpportunitySelect}
          hideOpportunitySelector={hideOpportunitySelector}
        />
      </Suspense>
    </QuestionsProvider>
  );
}
