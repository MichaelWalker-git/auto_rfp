'use client';

import React, { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, FolderPlus, Rocket, User, Mail, Phone, Briefcase, Users, Info, X } from 'lucide-react';
import { CreateProjectSchema } from '@auto-rfp/core';
import type { z } from 'zod';
import type { UserListItem } from '@auto-rfp/core';

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
import { useToast } from '@/components/ui/use-toast';
import { Spinner } from '@/components/ui/spinner';
import { useCreateProject } from '@/lib/hooks/use-create-project';
import { useUsersList } from '@/lib/hooks/use-user';
import { useAssignProjectAccess } from '@/lib/hooks/use-project-access';
import { useAuth } from '@/components/AuthProvider';

// ─── Types ───

type CreateProjectFormValues = z.input<typeof CreateProjectSchema>;

interface CreateProjectPageProps {
  params: Promise<{ orgId: string }>;
}

// ─── Page ───

export default function CreateProjectPage({ params }: CreateProjectPageProps) {
  const { orgId } = use(params);
  const { toast } = useToast();
  const router = useRouter();
  const { createProject } = useCreateProject();
  const { assign } = useAssignProjectAccess();
  const { userSub: currentUserId } = useAuth();

  // Fetch org users for team selection
  const { data: usersListResponse, isLoading: loadingUsers } = useUsersList(orgId, { limit: 200 });
  const orgUsers: UserListItem[] = usersListResponse?.items ?? [];
  
  // Filter out current user from selection (they get access automatically as creator)
  const selectableUsers = orgUsers.filter((u) => u.userId !== currentUserId);
  
  // Track selected users to grant access
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  const projectsUrl = `/organizations/${orgId}/projects`;

  const form = useForm<CreateProjectFormValues>({
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

  const { formState: { isSubmitting } } = form;

  const onSubmit = async (data: CreateProjectFormValues) => {
    try {
      const response = await createProject({
        orgId,
        name: data.name,
        description: data.description,
        ...((data.contactInfo?.primaryPocName || data.contactInfo?.primaryPocEmail || data.contactInfo?.primaryPocPhone || data.contactInfo?.primaryPocTitle)
          ? { contactInfo: data.contactInfo }
          : {}),
      });

      if (response.id) {
        // Grant access to selected team members (in parallel, non-blocking for navigation)
        if (selectedUserIds.size > 0) {
          const assignPromises = Array.from(selectedUserIds).map((userId) =>
            assign({ orgId, userId, projectId: response.id }).catch((err) => {
              console.warn(`Failed to assign user ${userId} to project:`, err);
              return null; // Don't fail the whole operation
            }),
          );
          // Fire and forget - don't block navigation
          Promise.all(assignPromises).then((results) => {
            const successCount = results.filter(Boolean).length;
            if (successCount > 0 && successCount < selectedUserIds.size) {
              toast({
                title: 'Partial Success',
                description: `Project created. ${successCount} of ${selectedUserIds.size} team members were added.`,
              });
            }
          });
        }

        toast({
          title: 'Project created',
          description: selectedUserIds.size > 0
            ? `"${response.name}" is ready. Adding ${selectedUserIds.size} team member(s)...`
            : `"${response.name}" is ready. Let's get started!`,
        });
        router.push(`/organizations/${orgId}/projects/${response.id}/dashboard`);
      } else {
        throw new Error('Failed to create project');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create project. Please try again.',
        variant: 'destructive',
      });
    }
  };

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
            <FolderPlus className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Create Project</h1>
            <p className="text-muted-foreground">
              Set up a new RFP project for your organization
            </p>
          </div>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Project Details Card */}
          <Card>
            <CardHeader>
              <CardTitle>Project Details</CardTitle>
              <CardDescription>
                Enter the basic information for your new project
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

          {/* Team Access Card */}
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
              {/* Info Alert */}
              <Alert className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <AlertDescription className="text-blue-700 dark:text-blue-300">
                  This project will only be visible to you by default. You can add team members now or later from project settings.
                </AlertDescription>
              </Alert>

              {/* Selected Users Display */}
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

              {/* User Selection */}
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
              <Link href={projectsUrl}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  Create Project
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
