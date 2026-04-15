'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, User, Mail, Phone, Briefcase, Users, Info, X } from 'lucide-react';
import { CreateProjectSchema } from '@auto-rfp/core';
import type { z } from 'zod';
import type { UserListItem, ProjectItem } from '@auto-rfp/core';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Spinner } from '@/components/ui/spinner';
import { useUsersList } from '@/lib/hooks/use-user';
import { useAuth } from '@/components/AuthProvider';
import { ProjectAccessManager } from './ProjectAccessManager';

// ─── Types ───

type ProjectFormValues = z.input<typeof CreateProjectSchema>;

interface ProjectFormProps {
  orgId: string;
  /** Existing project to edit. When null, the form is in create mode. */
  project: ProjectItem | null;
  /** Page title shown in the header */
  title: string;
  /** Subtitle shown below the title */
  subtitle: React.ReactNode;
  /** Icon to display in the header */
  headerIcon: React.ReactNode;
  /** Label for the submit button */
  submitLabel: string;
  /** Label shown while submitting */
  submittingLabel: string;
  /** Icon for the submit button */
  submitIcon: React.ReactNode;
  /** URL to navigate back to */
  backUrl: string;
  /** Called when the form is submitted with validated data + selected user IDs (create only) */
  onSubmit: (data: ProjectFormValues, selectedUserIds: Set<string>) => Promise<void>;
}

// ─── Loading Skeleton ───

export const ProjectFormSkeleton = () => (
  <div className="container max-w-3xl mx-auto py-6 px-4">
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-[104px] w-full" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  </div>
);

// ─── Component ───

export const ProjectForm = ({
  orgId,
  project,
  title,
  subtitle,
  headerIcon,
  submitLabel,
  submittingLabel,
  submitIcon,
  backUrl,
  onSubmit,
}: ProjectFormProps) => {
  const { userSub: currentUserId } = useAuth();
  const isEditMode = project !== null;

  // Fetch org users for team selection (create mode)
  const { data: usersListResponse, isLoading: loadingUsers } = useUsersList(
    orgId,
    { limit: 200 },
  );
  const orgUsers: UserListItem[] = usersListResponse?.items ?? [];
  const selectableUsers = orgUsers.filter((u) => u.userId !== currentUserId);

  // Track selected users (create mode only)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      orgId,
      name: '',
      description: '',
      contactInfo: {
        primaryPocName: '',
        primaryPocEmail: '',
        primaryPocPhone: '',
        primaryPocTitle: '',
      },
    },
  });

  const { formState: { isSubmitting, isDirty } } = form;

  // Populate form when editing an existing project
  useEffect(() => {
    if (project) {
      form.reset({
        orgId,
        name: project.name,
        description: project.description ?? '',
        contactInfo: {
          primaryPocName: project.contactInfo?.primaryPocName ?? '',
          primaryPocEmail: project.contactInfo?.primaryPocEmail ?? '',
          primaryPocPhone: project.contactInfo?.primaryPocPhone ?? '',
          primaryPocTitle: project.contactInfo?.primaryPocTitle ?? '',
        },
      });
    }
  }, [project, form, orgId]);

  const handleSubmit = async (data: ProjectFormValues) => {
    await onSubmit(data, selectedUserIds);
  };

  return (
    <div className="container max-w-3xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Link
            href={backUrl}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            title="Back to Projects"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="p-2 bg-primary/10 rounded-lg">
            {headerIcon}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>
          {isEditMode && isDirty && (
            <span className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 rounded-md">
              Unsaved changes
            </span>
          )}
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          {/* Project Details Card */}
          <Card>
            <CardHeader>
              <CardTitle>Project Details</CardTitle>
              <CardDescription>
                {isEditMode
                  ? 'Update the basic information for your project'
                  : 'Enter the basic information for your new project'}
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

          {/* Team Access — Create mode: inline checkboxes */}
          {!isEditMode && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  Team Access
                </CardTitle>
                <CardDescription>
                  Choose who can access this project
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <AlertDescription className="text-blue-700 dark:text-blue-300">
                    This project will only be visible to you by default. You can add team members now or later from project settings.
                  </AlertDescription>
                </Alert>

                {selectedUserIds.size > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">
                      Team members to add ({selectedUserIds.size}):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(selectedUserIds).map((userId) => {
                        const user = orgUsers.find((u) => u.userId === userId);
                        if (!user) return null;
                        return (
                          <Badge
                            key={userId}
                            variant="secondary"
                            className="flex items-center gap-1 pr-1"
                          >
                            {user.displayName || user.email}
                            <button
                              type="button"
                              onClick={() => {
                                const next = new Set(selectedUserIds);
                                next.delete(userId);
                                setSelectedUserIds(next);
                              }}
                              className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                              aria-label={`Remove ${user.displayName || user.email}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-sm font-medium">Add team members (optional):</div>
                  {loadingUsers ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : selectableUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      No other users in this organization yet.
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                      {selectableUsers.map((user) => {
                        const isSelected = selectedUserIds.has(user.userId);
                        return (
                          <label
                            key={user.userId}
                            className="flex items-center gap-3 p-3 hover:bg-accent/50 cursor-pointer"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedUserIds);
                                if (checked) {
                                  next.add(user.userId);
                                } else {
                                  next.delete(user.userId);
                                }
                                setSelectedUserIds(next);
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">
                                {user.displayName || user.email}
                                {user.role === 'ADMIN' && (
                                  <Badge variant="outline" className="ml-2 text-xs">
                                    Admin
                                  </Badge>
                                )}
                              </div>
                              {user.displayName && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {user.email}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Team Access — Edit mode: full access manager */}
          {isEditMode && project && (
            <ProjectAccessManager
              orgId={orgId}
              projectId={project.id}
              projectCreatorId={project.createdBy}
            />
          )}

          {/* Contact Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-muted-foreground" />
                Primary Point of Contact
              </CardTitle>
              <CardDescription>
                Optional — add the primary contact person for this project
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contactInfo.primaryPocName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        Full Name
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Smith" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactInfo.primaryPocTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                        Title / Role
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Program Manager" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contactInfo.primaryPocEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        Email
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="jane@example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactInfo.primaryPocPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        Phone
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder="(555) 123-4567"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Separator />
          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" asChild>
              <Link href={backUrl}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting || (isEditMode && !isDirty)}>
              {isSubmitting ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  {submittingLabel}
                </>
              ) : (
                <>
                  {submitIcon}
                  {submitLabel}
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};