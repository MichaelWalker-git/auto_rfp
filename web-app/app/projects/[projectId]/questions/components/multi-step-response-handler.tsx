"use client"

import React from "react"
import { MultiStepResponseDialog } from "@/components/ui/multi-step-response-dialog"
import { useQuestions } from "./questions-provider"

export function MultiStepResponseHandler() {
  const {
    multiStepDialogOpen,
    currentQuestionText,
    isMultiStepGenerating,
    multiStepSteps,
    multiStepFinalResponse,
    multiStepSources,
    handleAcceptMultiStepResponse,
    handleCloseMultiStepDialog,
  } = useQuestions();

  return (
    <MultiStepResponseDialog
      isOpen={multiStepDialogOpen}
      onClose={handleCloseMultiStepDialog}
      questionText={currentQuestionText || ""}
      isGenerating={isMultiStepGenerating}
      currentSteps={multiStepSteps}
      finalResponse={multiStepFinalResponse || ""}
      sources={multiStepSources}
      onAcceptResponse={handleAcceptMultiStepResponse}
    />
  );
} 