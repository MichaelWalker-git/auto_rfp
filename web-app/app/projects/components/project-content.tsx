"use client"

import React, { useState, Suspense } from "react"
import { ProjectOverview } from "./project-overview"
import { QuestionsSection } from "../[projectId]/questions/components"
import { DocumentsSection } from "./documents-section"
import { TeamSection } from "./team-section"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

// Inner component that uses search params
function ProjectContentInner({ projectId }: { projectId: string }) {
  const [activeSection, setActiveSection] = useState("overview")
  const searchParams = useSearchParams()
  const router = useRouter()
  const orgId = searchParams.get("orgId")

  // Function to navigate between sections
  const navigateToSection = (section: string) => {
    setActiveSection(section)
  }


  // This would be connected to the sidebar navigation in a real implementation
  const renderContent = () => {
    switch (activeSection) {
      case "questions":
        return <QuestionsSection projectId={projectId} />
      case "documents":
        return <DocumentsSection />
      case "team":
        return <TeamSection />
      case "overview":
      default:
        return (
          <ProjectOverview 
            onViewQuestions={() => navigateToSection("questions")} 
            projectId={projectId}
            orgId={orgId}
          />
        )
    }
  }

  return (
    <div className="container py-6">
      {renderContent()}
    </div>
  )
}

export function ProjectContent({ projectId }: { projectId: string }) {
  return (
    <Suspense fallback={
      <div className="container py-6">
        <div className="space-y-4">
          <div className="h-10 w-48 animate-pulse bg-muted rounded"></div>
          <div className="h-32 animate-pulse bg-muted rounded"></div>
          <div className="h-64 animate-pulse bg-muted rounded"></div>
        </div>
      </div>
    }>
      <ProjectContentInner projectId={projectId} />
    </Suspense>
  )
}
