"use client"

import React from "react"
import { AlertCircle } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"

export function QuestionsLoadingState() {
  return (
    <div className="flex items-center justify-center h-[400px]">
      <div className="text-center">
        <Spinner size="lg" className="mb-4" />
        <p>Loading questions...</p>
      </div>
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
  );
} 