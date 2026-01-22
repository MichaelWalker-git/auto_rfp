"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft } from "lucide-react";

interface NewProjectPageProps {
  params: Promise<{ orgId: string }>;
}

export default function NewProjectPage({ params }: NewProjectPageProps) {
  const unwrappedParams = React.use(params);
  const { orgId } = unwrappedParams;
  const router = useRouter();
  const { toast } = useToast();
  
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!projectName.trim()) {
      toast({
        title: "Error",
        description: "Project name is required",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectName,
          description: projectDescription,
          organizationId: orgId,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create project");
      }
      
      const newProject = await response.json();
      
      toast({
        title: "Success",
        description: "Project created successfully",
      });
      
      // Redirect to the project page
      router.push(`/project/${newProject.id}?orgId=${orgId}`);
    } catch (error) {
      console.error("Error creating project:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create project",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleCancel = () => {
    router.push(`/org/${orgId}`);
  };
  
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8">
        <div className="flex flex-col items-center space-y-6">
          <div className="w-full">
        <Button
          variant="ghost"
          className="gap-1 mb-4"
          onClick={handleCancel}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Button>
          </div>
          
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">Create a new project</h1>
        <p className="text-muted-foreground">Add details to create your new RFP project</p>
      </div>
      
          <div className="w-full max-w-lg">
      <form onSubmit={handleSubmit}>
              <Card className="shadow-lg">
                <CardHeader className="text-center">
            <CardTitle>Project details</CardTitle>
            <CardDescription>
              Enter the information for your new project
            </CardDescription>
          </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <Input
                id="name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name"
                required
                      className="h-11"
              />
            </div>
            
                  <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="description"
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Enter project description (optional)"
                rows={4}
                      className="resize-none"
              />
            </div>
          </CardContent>
                <CardFooter className="flex justify-between gap-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleCancel}
                    className="flex-1"
                  >
              Cancel
            </Button>
                  <Button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="flex-1"
                  >
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>
          </div>
        </div>
      </div>
    </div>
  );
} 