'use client';

import React, { Suspense, use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { ArrowLeft, GripVertical, Plus, Save, Trash2, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useProject } from '@/lib/hooks/use-api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Section = {
  id: string;
  title: string;
  questions: Question[];
};

type Question = {
  id: string;
  question: string;
};

function CreateQuestionsPageInner({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data: project, isLoading } = useProject(projectId);

  const [isSaving, setIsSaving] = useState(false);
  const [sections, setSections] = useState<Section[]>([
    {
      id: uuidv4(),
      title: '',
      questions: [{ id: uuidv4(), question: '' }],
    },
  ]);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: 'section' | 'question';
    sectionId?: string;
    questionId?: string;
  }>({ open: false, type: 'section' });

  const addSection = () => {
    setSections([
      ...sections,
      {
        id: uuidv4(),
        title: '',
        questions: [{ id: uuidv4(), question: '' }],
      },
    ]);
  };

  const updateSectionTitle = (sectionId: string, title: string) => {
    setSections(
      sections.map((section) =>
        section.id === sectionId ? { ...section, title } : section
      )
    );
  };

  const addQuestion = (sectionId: string) => {
    setSections(
      sections.map((section) =>
        section.id === sectionId
          ? {
            ...section,
            questions: [...section.questions, { id: uuidv4(), question: '' }],
          }
          : section
      )
    );
  };

  const updateQuestion = (sectionId: string, questionId: string, question: string) => {
    setSections(
      sections.map((section) =>
        section.id === sectionId
          ? {
            ...section,
            questions: section.questions.map((q) =>
              q.id === questionId ? { ...q, question } : q
            ),
          }
          : section
      )
    );
  };

  const confirmRemoveQuestion = (sectionId: string, questionId: string) => {
    setDeleteDialog({
      open: true,
      type: 'question',
      sectionId,
      questionId,
    });
  };

  const removeQuestion = () => {
    if (deleteDialog.sectionId && deleteDialog.questionId) {
      setSections(
        sections.map((section) =>
          section.id === deleteDialog.sectionId
            ? {
              ...section,
              questions: section.questions.filter(
                (q) => q.id !== deleteDialog.questionId
              ),
            }
            : section
        )
      );
    }
    setDeleteDialog({ open: false, type: 'question' });
  };

  const confirmRemoveSection = (sectionId: string) => {
    setDeleteDialog({
      open: true,
      type: 'section',
      sectionId,
    });
  };

  const removeSection = () => {
    if (deleteDialog.sectionId) {
      setSections(sections.filter((section) => section.id !== deleteDialog.sectionId));
    }
    setDeleteDialog({ open: false, type: 'section' });
  };

  const validateQuestions = () => {
    const emptySections = sections.filter((s) => !s.title.trim());
    if (emptySections.length > 0) {
      toast({
        title: 'Missing Section Titles',
        description: `${emptySections.length} section${emptySections.length > 1 ? 's' : ''} need titles`,
        variant: 'destructive',
      });
      return false;
    }

    const emptyQuestions = sections.reduce(
      (count, s) => count + s.questions.filter((q) => !q.question.trim()).length,
      0
    );
    if (emptyQuestions > 0) {
      toast({
        title: 'Empty Questions',
        description: `${emptyQuestions} question${emptyQuestions > 1 ? 's' : ''} need content`,
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const saveQuestions = async () => {
    if (!projectId) {
      toast({
        title: 'Error',
        description: 'No project ID provided',
        variant: 'destructive',
      });
      return;
    }

    if (!validateQuestions()) return;

    setIsSaving(true);

    try {
      const rfpDocument = {
        documentId: projectId,
        documentName: project?.name || 'Manual Questions',
        sections: sections.map((section) => ({
          id: section.id,
          title: section.title,
          questions: section.questions,
        })),
        extractedAt: new Date().toISOString(),
      };

      // TODO: Implement API call to save questions
      await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate API call

      toast({
        title: 'Success',
        description: 'Questions saved successfully',
      });

      router.push(`/projects/${projectId}/questions`);
    } catch (error) {
      console.error('Error saving questions:', error);
      toast({
        title: 'Error',
        description: 'Failed to save questions. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const goBack = () => {
    router.push(`/projects/${projectId}/questions`);
  };

  const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Spinner size="lg" className="mb-4"/>
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="container max-w-5xl py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={goBack}>
                <ArrowLeft className="h-5 w-5"/>
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Create Questions</h1>
                <p className="text-sm text-muted-foreground">
                  {sections.length} section{sections.length !== 1 ? 's' : ''} · {totalQuestions}{' '}
                  question{totalQuestions !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            <Button onClick={saveQuestions} disabled={isSaving} className="gap-2">
              {isSaving ? (
                <>
                  <Spinner className="h-4 w-4"/>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4"/>
                  Save Questions
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container max-w-5xl py-8 space-y-6">
        {sections.map((section, sectionIndex) => (
          <Card key={section.id} className="shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-start gap-3">
                <div className="mt-2 text-muted-foreground cursor-grab">
                  <GripVertical className="h-5 w-5"/>
                </div>
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder={`Section ${sectionIndex + 1} Title`}
                    value={section.title}
                    onChange={(e) => updateSectionTitle(section.id, e.target.value)}
                    className="text-lg font-semibold border-0 px-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
                  />
                  <CardDescription>
                    {section.questions.length} question
                    {section.questions.length !== 1 ? 's' : ''}
                  </CardDescription>
                </div>
                {sections.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => confirmRemoveSection(section.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4"/>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {section.questions.map((q, questionIndex) => (
                <div key={q.id} className="group relative">
                  <div
                    className="flex items-start gap-3 bg-muted/50 rounded-lg p-3 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-colors">
                    <span className="text-sm font-medium text-muted-foreground mt-2 min-w-[20px]">
                      {questionIndex + 1}.
                    </span>
                    <Textarea
                      placeholder="Enter your question here..."
                      value={q.question}
                      onChange={(e) => updateQuestion(section.id, q.id, e.target.value)}
                      className="flex-1 min-h-[60px] resize-none border-0 bg-transparent focus-visible:ring-0 p-0"
                    />
                    {section.questions.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => confirmRemoveQuestion(section.id, q.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="h-4 w-4"/>
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-2 gap-2 text-muted-foreground hover:text-foreground border-dashed border"
                onClick={() => addQuestion(section.id)}
              >
                <Plus className="h-4 w-4"/>
                Add Question
              </Button>
            </CardContent>
          </Card>
        ))}

        <Button
          variant="outline"
          className="w-full py-8 border-dashed gap-2 hover:border-primary hover:text-primary"
          onClick={addSection}
        >
          <Plus className="h-5 w-5"/>
          Add New Section
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog.open}
                   onOpenChange={(open) => !open && setDeleteDialog({ open: false, type: 'section' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteDialog.type === 'section' ? 'Section' : 'Question'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialog.type === 'section'
                ? 'This will permanently delete this section and all its questions. This action cannot be undone.'
                : 'This will permanently delete this question. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteDialog.type === 'section' ? removeSection : removeQuestion}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster/>
    </div>
  );
}

export default function CreateQuestionsPage({
                                              params,
                                            }: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <Spinner size="lg" className="mb-4"/>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <CreateQuestionsPageInner projectId={projectId}/>
    </Suspense>
  );
}