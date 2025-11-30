"use client"

import { useSearchParams } from "next/navigation"
import { ProjectIndexSelector } from "@/components/projects/ProjectIndexSelector"
import { ProjectDocuments } from "@/components/projects/ProjectDocuments"

interface DocumentsSectionProps {
  projectId?: string
}

export function DocumentsSection({ projectId: propProjectId }: DocumentsSectionProps) {
  const searchParams = useSearchParams()
  // Use prop if provided, otherwise fall back to search params
  const projectId = propProjectId || searchParams.get("projectId")

  if (!projectId) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Documents</h2>
        <div className="text-center py-8">
          <p className="text-muted-foreground">No project selected</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-12">
      <h2 className="text-2xl font-bold">Documents</h2>
      
      {/* Project Index Selection */}
      <ProjectIndexSelector projectId={projectId} />
      
      {/* Project Documents from Selected Indexes */}
      <ProjectDocuments projectId={projectId} />
    </div>
  )
}
