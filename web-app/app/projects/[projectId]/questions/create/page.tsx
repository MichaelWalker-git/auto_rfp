"use client"

import React, { useState, useEffect, Suspense, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/use-toast"
import { Toaster } from "@/components/ui/toaster"
import { AlertCircle, Plus, Save, ArrowLeft, Trash2 } from "lucide-react"
import { v4 as uuidv4 } from 'uuid'

type Section = {
  id: string;
  title: string;
  questions: Question[];
}

type Question = {
  id: string;
  question: string;
}

function CreateQuestionsPageInner( { projectId }: { projectId: string } ) {
  const router = useRouter();
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Initialize with one empty section with one empty question
  const [sections, setSections] = useState<Section[]>([
    {
      id: uuidv4(),
      title: "",
      questions: [{ id: uuidv4(), question: "" }]
    }
  ]);

  // Load project data
  useEffect(() => {
    if (!projectId) {
      setError("No project ID provided");
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
        setIsLoading(false);
      } catch (error) {
        console.error("Error loading project:", error);
        setError("Failed to load project. Please try again.");
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [projectId]);

  // Add new section
  const addSection = () => {
    setSections([
      ...sections,
      {
        id: uuidv4(),
        title: "",
        questions: [{ id: uuidv4(), question: "" }]
      }
    ]);
  };

  // Update section title
  const updateSectionTitle = (sectionId: string, title: string) => {
    setSections(sections.map(section => 
      section.id === sectionId ? { ...section, title } : section
    ));
  };

  // Add question to section
  const addQuestion = (sectionId: string) => {
    setSections(sections.map(section => 
      section.id === sectionId 
        ? { ...section, questions: [...section.questions, { id: uuidv4(), question: "" }] }
        : section
    ));
  };

  // Update question text
  const updateQuestion = (sectionId: string, questionId: string, questionText: string) => {
    setSections(sections.map(section => 
      section.id === sectionId 
        ? { 
            ...section, 
            questions: section.questions.map(q => 
              q.id === questionId ? { ...q, question: questionText } : q
            ) 
          }
        : section
    ));
  };

  // Remove question
  const removeQuestion = (sectionId: string, questionId: string) => {
    setSections(sections.map(section => 
      section.id === sectionId 
        ? { 
            ...section, 
            questions: section.questions.filter(q => q.id !== questionId)
          }
        : section
    ));
  };

  // Remove section
  const removeSection = (sectionId: string) => {
    setSections(sections.filter(section => section.id !== sectionId));
  };

  // Save all questions
  const saveQuestions = async () => {
    if (!projectId) {
      toast({
        title: "Error",
        description: "No project ID provided",
        variant: "destructive",
      });
      return;
    }

    // Validate data
    if (sections.some(section => !section.title.trim())) {
      toast({
        title: "Validation Error",
        description: "All sections must have titles",
        variant: "destructive",
      });
      return;
    }

    if (sections.some(section => section.questions.some(q => !q.question.trim()))) {
      toast({
        title: "Validation Error",
        description: "All questions must have content",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    try {
      // Prepare the RFP document format
      const rfpDocument = {
        documentId: projectId,
        documentName: project?.name || "Manual Questions",
        sections: sections.map(section => ({
          id: section.id,
          title: section.title,
          questions: section.questions
        })),
        extractedAt: new Date().toISOString(),
      };

      // Save the questions to the database
      const response = await fetch(`/api/questions/${projectId}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rfpDocument),
      });

      if (!response.ok) {
        throw new Error("Failed to save questions");
      }

      toast({
        title: "Success",
        description: "Questions saved successfully",
      });

      // Redirect to questions page
      router.push(`/projects/${projectId}/questions`);
    } catch (error) {
      console.error("Error saving questions:", error);
      toast({
        title: "Error",
        description: "Failed to save questions. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Back to questions
  const goBack = () => {
    router.push(`/projects/${projectId}/questions`);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Spinner size="lg" className="mb-4" />
          <p>Loading project...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium">Error</h3>
        <p className="text-muted-foreground mt-2">{error}</p>
        <Button onClick={goBack} className="mt-4">Go Back</Button>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Create Questions</h1>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="default"
            onClick={saveQuestions}
            disabled={isSaving}
            className="gap-2"
          >
            {isSaving ? (
              <>
                <Spinner className="h-4 w-4" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Questions
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {sections.map((section, sectionIndex) => (
          <Card key={section.id} className="shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <Input
                  placeholder="Section Title"
                  value={section.title}
                  onChange={(e) => updateSectionTitle(section.id, e.target.value)}
                  className="text-lg font-semibold border-0 p-0 h-auto focus-visible:ring-0"
                />
                {sections.length > 1 && (
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => removeSection(section.id)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
              <CardDescription>
                {section.questions.length} question{section.questions.length !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {section.questions.map((q, questionIndex) => (
                <div key={q.id} className="flex items-start gap-2">
                  <div className="flex-1">
                    <Textarea
                      placeholder="Enter question text"
                      value={q.question}
                      onChange={(e) => updateQuestion(section.id, q.id, e.target.value)}
                      className="min-h-[80px]"
                    />
                  </div>
                  {section.questions.length > 1 && (
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => removeQuestion(section.id, q.id)}
                      className="mt-4"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}
              
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1"
                onClick={() => addQuestion(section.id)}
              >
                <Plus className="h-4 w-4" />
                Add Question
              </Button>
            </CardContent>
          </Card>
        ))}
        
        <Button
          variant="outline"
          className="w-full py-8 border-dashed gap-2"
          onClick={addSection}
        >
          <Plus className="h-4 w-4" />
          Add New Section
        </Button>
      </div>
      
      <Toaster />
    </div>
  );
}

// Main export that wraps the inner component with Suspense
export default function CreateQuestionsPage( { params }: { params: Promise<{ projectId: string }> } ) {
  const { projectId } = use(params);

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <div className="flex flex-col items-center justify-center h-64">
            <Spinner size="lg" className="mb-4" />
            <p>Loading create questions page...</p>
          </div>
        </div>
      </div>
    }>
      <CreateQuestionsPageInner projectId={projectId} />
    </Suspense>
  );
} 