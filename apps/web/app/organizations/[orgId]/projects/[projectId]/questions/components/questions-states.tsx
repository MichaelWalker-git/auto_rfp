"use client"

import React from "react"
import { AlertCircle } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

interface QuestionsLoadingStateProps {
  isQuestionsLoading?: boolean;
  isAnswersLoading?: boolean;
}

export function QuestionsLoadingState({ isQuestionsLoading = true, isAnswersLoading = true }: QuestionsLoadingStateProps) {
  return (
    <div className="space-y-6">
      {/* Header skeleton — filter tabs + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Questions list skeleton */}
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-6 space-y-4">
          {/* Question text */}
          <div className="space-y-2">
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-4 w-1/2" />
          </div>

          {/* Answer area */}
          {(isAnswersLoading || isQuestionsLoading) && (
            <div className="space-y-2 pt-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}

          {/* Footer — status badge + actions */}
          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface QuestionsErrorStateProps {
  error: string;
}

export function QuestionsErrorState({ error }: QuestionsErrorStateProps) {
  return (
    <div className="p-8 text-center">
      <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-4" />
      <h3 className="text-lg font-medium">Error Loading Questions</h3>
      <p className="text-muted-foreground mt-2">{error}</p>
    </div>
  );
}

export function QuestionsSkeletonLoader() {
  return (
    <div className="space-y-6 p-12">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-36" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-[500px] w-full" />
    </div>
  );
} 