'use client';

import React, { useState, useEffect } from "react";
import { Organization } from "@/types/organization";
import { Project } from "@/types/project";
import { useOrganization, useOrganizationProjects } from "@/lib/hooks/use-api";
import { useToast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { ProjectsHeader } from "./ProjectsHeader";
import { ProjectsList } from "./ProjectsList";

interface OrganizationContentProps {
  orgId: string;
}

export function OrganizationContent({ orgId }: OrganizationContentProps) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const router = useRouter();

  const { data: orgData, isLoading: isOrgLoading, isError: isOrgError } = useOrganization(orgId);
  const { data: projectsData, isLoading: isProjectsLoading, isError: isProjectsError } = useOrganizationProjects(orgId);
  
  useEffect(() => {
    if (orgData) {
      setOrganization(orgData as Organization);
    }
    
    if (projectsData && Array.isArray(projectsData)) {
      setProjects(projectsData);
    }
    
    // Set loading state based on both data sources
    setIsLoading(isOrgLoading || isProjectsLoading);
    
    // Handle errors
    if (isOrgError || isProjectsError) {
      toast({
        title: "Error",
        description: "Failed to load data",
        variant: "destructive",
      });
    }
  }, [orgData, projectsData, isOrgLoading, isProjectsLoading, isOrgError, isProjectsError, toast]);

  // Filter projects based on search
  const filteredProjects = projects.filter(project => 
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (project.description && project.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleNewProject = () => {
    router.push(`/org/${orgId}/new-project`);
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="py-6 px-4 sm:px-6">
        <div className="flex flex-col gap-6">
          <ProjectsHeader 
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onNewProject={handleNewProject}
          />

          <ProjectsList 
            projects={filteredProjects}
            organization={organization}
            orgId={orgId}
            isLoading={isLoading}
            onCreateProject={handleNewProject}
          />
        </div>
      </div>
    </div>
  );
} 