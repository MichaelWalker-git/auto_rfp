"use client"

import { useRouter } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { UploadComponent } from "@/components/upload/UploadComponent";

// Inner component that uses search params
function UploadPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  
  const [project, setProject] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load project data
  useEffect(() => {
    if (!projectId) {
      setError("No project ID provided. Please create or select a project first.");
      setIsLoading(false);
      return;
    }

    const fetchProject = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`);
        
        if (!response.ok) {
          throw new Error("Failed to load project");
        }
        
        const data = await response.json();
        setProject(data);
        
        // TODO: In a real implementation, we would fetch the project's
        // existing documents here and populate uploadedFiles
        
      } catch (error) {
        console.error("Error loading project:", error);
        setError("Failed to load project. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [projectId]);

  // Handle view questions button click
  const handleViewQuestions = (projectId: string) => {
    router.push(`/projects/${projectId}/questions`);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex flex-col items-center justify-center h-64">
          <Spinner size="lg" className="mb-4" />
          <p>Loading project...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex flex-col items-center justify-center h-64">
          <div className="text-red-500 mb-4">{error}</div>
          <Button onClick={() => router.push("/")}>
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="flex flex-col items-center">
          <UploadComponent projectId={projectId} />
        </div>
      </div>
    </div>
  );
}

// Main export that wraps the inner component with Suspense
function UploadPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <div className="flex flex-col items-center justify-center h-64">
            <Spinner size="lg" className="mb-4" />
            <p>Loading upload page...</p>
          </div>
        </div>
      </div>
    }>
      <UploadPageInner />
    </Suspense>
  );
}

export default UploadPage;