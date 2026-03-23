'use client';

import React, { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSWRConfig } from 'swr';
import { ArrowLeft, FolderOpen, Save } from 'lucide-react';
import { UpdateProjectSchema } from '@auto-rfp/core';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/components/ui/use-toast';
import { Spinner } from '@/components/ui/spinner';
import { useUpdateProject } from '@/lib/hooks/use-update-project';
import { useProject } from '@/lib/hooks/use-api';

// ─── Types ───

type EditProjectFormValues = z.input<typeof UpdateProjectSchema>;

interface EditProjectPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

// ─── Loading Skeleton (matches page layout) ───

export const EditProjectSkeleton = () => (
  <div className="container max-w-3xl mx-auto py-6 px-4">
    {/* Header skeleton */}
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
    </div>

    {/* Card skeleton */}
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-64 mt-1" />
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Name field */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        {/* Description field */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[104px] w-full" />
          <Skeleton className="h-3.5 w-80" />
        </div>
      </CardContent>
    </Card>

    {/* Actions skeleton */}
    <Separator className="mt-6" />
    <div className="flex items-center justify-between mt-6">
      <Skeleton className="h-10 w-20" />
      <Skeleton className="h-10 w-32" />
    </div>
  </div>
);

// ─── Not Found State ───

const ProjectNotFound = ({ backUrl }: { backUrl: string }) => (
  <div className="container max-w-3xl mx-auto py-16 px-4">
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <FolderOpen className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">Project not found</h2>
      <p className="text-muted-foreground mb-6">
        The project you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Button asChild>
        <Link href={backUrl}>Back to Projects</Link>
      </Button>
    </div>
  </div>
);

// ─── Page ───

export default function EditProjectPage({ params }: EditProjectPageProps) {
  const { orgId, projectId } = use(params);
  const { toast } = useToast();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { updateProject } = useUpdateProject();
  const { data: project, isLoading } = useProject(projectId);

  const form = useForm<EditProjectFormValues>({
    resolver: zodResolver(UpdateProjectSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const { formState: { isSubmitting, isDirty } } = form;

  // Populate form when project data loads
  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        description: project.description ?? '',
      });
    }
  }, [project, form]);

  const projectsUrl = `/organizations/${orgId}/projects`;

  const onSubmit = async (data: EditProjectFormValues) => {
    try {
      const response = await updateProject({
        orgId,
        projectId,
        name: data.name ?? '',
        description: data.description,
      });

      if (response.id) {
        // Invalidate project caches so lists and detail views reflect the update
        await Promise.all([
          mutate((key: unknown) =>
            Array.isArray(key) && key[0] === 'project' && key[1] === projectId,
          ),
          mutate((key: unknown) =>
            Array.isArray(key) && key[0] === 'project/projects',
          ),
        ]);

        toast({
          title: 'Project updated',
          description: `"${response.name}" has been saved successfully.`,
        });
        router.push(projectsUrl);
      } else {
        throw new Error('Failed to update project');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update project. Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <EditProjectSkeleton />;
  }

  if (!project) {
    return <ProjectNotFound backUrl={projectsUrl} />;
  }

  return (
    <div className="container max-w-3xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Link
            href={projectsUrl}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            title="Back to Projects"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="p-2 bg-primary/10 rounded-lg">
            <FolderOpen className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Edit Project</h1>
            <p className="text-muted-foreground">
              Update details for <span className="font-medium text-foreground">{project.name}</span>
            </p>
          </div>
          {isDirty && (
            <span className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 rounded-md">
              Unsaved changes
            </span>
          )}
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Project Details Card */}
          <Card>
            <CardHeader>
              <CardTitle>Project Details</CardTitle>
              <CardDescription>
                Update the basic information for your project
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Cloud Migration RFP Response"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Choose a descriptive name that identifies this project
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Brief description of the project scope, objectives, and target agency..."
                        rows={4}
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Provide context about the project to help your team understand its purpose
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <Separator />
          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" asChild>
              <Link href={projectsUrl}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
